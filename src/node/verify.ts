/**
 * Verification of the declared model against the repository. It only reports
 * discrepancies with evidence; it never creates or changes model entities.
 *
 * Status of a finding:
 * - verified: a directly observed fact (e.g. a referenced path does not exist).
 * - inferred: a heuristic result that needs review (e.g. an import between two
 *   elements without a declared relation).
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { LineCounter, parseDocument, isMap, isScalar } from 'yaml';
import { isDeleted, type Model } from '../core/model.js';
import { categoryOf, MODEL_DIR, type Element } from '../core/schema.js';

export type FindingStatus = 'verified' | 'inferred';

export interface Finding {
  adapter: 'code-refs' | 'typescript' | 'sql' | 'compose' | 'terraform';
  code: string;
  status: FindingStatus;
  message: string;
  elementId?: string;
  evidence: { file: string; line?: number }[];
}

export interface AdapterNote {
  adapter: Finding['adapter'];
  applied: boolean;
  note: string;
}

export interface VerifyReport {
  findings: Finding[];
  adapters: AdapterNote[];
  scannedFiles: number;
  /** True when the file limit was reached and part of the repository was not scanned. */
  truncated: boolean;
}

export const VERIFY_LIMITS = { maxFiles: 20_000, maxFileBytes: 512 * 1024 };
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.next', 'target', '.venv', '__pycache__', MODEL_DIR]);
const TS_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

interface RepoFiles {
  root: string;
  files: Set<string>;
  truncated: boolean;
  read(rel: string): Promise<string | null>;
}

async function listFiles(root: string): Promise<RepoFiles> {
  const files = new Set<string>();
  let truncated = false;
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.size >= VERIFY_LIMITS.maxFiles) {
        truncated = true;
        return;
      }
      if (e.isSymbolicLink()) continue; // never follow links out of the repository
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), r);
      } else if (e.isFile()) files.add(r);
    }
  };
  await walk(root, '');
  const cache = new Map<string, string | null>();
  return {
    root,
    files,
    truncated,
    async read(rel) {
      if (cache.has(rel)) return cache.get(rel)!;
      let content: string | null = null;
      try {
        const full = path.join(root, rel);
        if ((await lstat(full)).size <= VERIFY_LIMITS.maxFileBytes) content = await readFile(full, 'utf8');
      } catch {
        content = null;
      }
      cache.set(rel, content);
      return content;
    },
  };
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cleanPath = (p: string) => p.replace(/^\.\//, '').replace(/\/+$/, '');

async function codeRefs(model: Model, repo: RepoFiles, findings: Finding[]): Promise<AdapterNote> {
  let count = 0;
  for (const el of model.elements) {
    if (isDeleted(el)) continue;
    for (const ref of el.code ?? []) {
      count++;
      const p = cleanPath(ref.path);
      const full = path.join(repo.root, p);
      let info;
      try {
        info = await lstat(full);
      } catch {
        info = null;
      }
      if (!info || info.isSymbolicLink()) {
        findings.push({
          adapter: 'code-refs',
          code: 'missing-code-path',
          status: 'verified',
          message: `"${el.name}" references ${p}, which does not exist in the repository`,
          elementId: el.id,
          evidence: [{ file: p }],
        });
        continue;
      }
      if (!info.isFile() || (!ref.symbol && !ref.line)) continue;
      const text = await repo.read(p);
      if (text === null) continue;
      if (ref.line && ref.line > text.split('\n').length) {
        findings.push({
          adapter: 'code-refs',
          code: 'line-out-of-range',
          status: 'verified',
          message: `"${el.name}" references line ${ref.line} of ${p}, which has fewer lines`,
          elementId: el.id,
          evidence: [{ file: p }],
        });
      }
      if (ref.symbol) {
        const name = ref.symbol.split(/[.#:]/).pop()!;
        const re = new RegExp(`\\b${name.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}\\b`);
        if (!re.test(text)) {
          findings.push({
            adapter: 'code-refs',
            code: 'symbol-not-found',
            status: 'inferred',
            message: `Symbol "${ref.symbol}" of "${el.name}" was not found in ${p}`,
            elementId: el.id,
            evidence: [{ file: p }],
          });
        }
      }
    }
  }
  return { adapter: 'code-refs', applied: count > 0, note: count > 0 ? `${count} code reference(s) checked` : 'No element declares code references' };
}

/** Element owning a file: the one with the most specific code path containing it. */
function ownerIndex(model: Model) {
  const owners: { prefix: string; el: Element }[] = [];
  for (const el of model.elements) {
    if (isDeleted(el)) continue;
    for (const ref of el.code ?? []) owners.push({ prefix: cleanPath(ref.path), el });
  }
  owners.sort((a, b) => b.prefix.length - a.prefix.length);
  return (file: string) => owners.find((o) => file === o.prefix || file.startsWith(`${o.prefix}/`))?.el;
}

function resolveImport(from: string, spec: string, files: Set<string>): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const stem = base.replace(/\.(m|c)?js$/, '');
  const candidates = [
    base,
    ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map((e) => `${stem}${e}`),
    ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((i) => `${base}/${i}`),
  ];
  return candidates.find((c) => files.has(c));
}

async function typescript(model: Model, repo: RepoFiles, findings: Finding[]): Promise<AdapterNote> {
  const owner = ownerIndex(model);
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    let cur = model.elements.find((e) => e.id === id)?.parent;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = model.elements.find((e) => e.id === cur)?.parent;
    }
    return out;
  };
  const declared = new Set(model.relations.filter((r) => !isDeleted(r)).map((r) => `${r.from}>${r.to}`));
  const related = (a: string, b: string) => {
    const as = [a, ...ancestors(a)];
    const bs = [b, ...ancestors(b)];
    if (as.includes(b) || bs.includes(a)) return true; // containment
    return as.some((x) => bs.some((y) => declared.has(`${x}>${y}`)));
  };
  const pairs = new Map<string, Finding>();
  let scanned = 0;
  const importRe = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const file of repo.files) {
    if (!TS_EXT.test(file) || file.endsWith('.d.ts')) continue;
    const a = owner(file);
    if (!a) continue;
    const text = await repo.read(file);
    if (text === null) continue;
    scanned++;
    for (const m of text.matchAll(importRe)) {
      const spec = m[1] ?? m[2] ?? m[3]!;
      if (!spec.startsWith('.')) continue;
      const target = resolveImport(file, spec, repo.files);
      const b = target ? owner(target) : undefined;
      if (!b || b.id === a.id || related(a.id, b.id)) continue;
      const key = `${a.id}>${b.id}`;
      let f = pairs.get(key);
      if (!f) {
        f = {
          adapter: 'typescript',
          code: 'undeclared-dependency',
          status: 'inferred',
          message: `Code of "${a.name}" imports code of "${b.name}", but no relation between them is declared`,
          elementId: a.id,
          evidence: [],
        };
        pairs.set(key, f);
      }
      if (f.evidence.length < 3) f.evidence.push({ file, line: lineOf(text, m.index) });
    }
  }
  findings.push(...pairs.values());
  return {
    adapter: 'typescript',
    applied: scanned > 0,
    note: scanned > 0 ? `${scanned} TypeScript/JavaScript file(s) inside declared code paths scanned for relative imports` : 'No TypeScript/JavaScript files inside declared code paths',
  };
}

async function sql(model: Model, repo: RepoFiles, findings: Finding[]): Promise<AdapterNote> {
  const sqlFiles = [...repo.files].filter((f) => f.endsWith('.sql'));
  if (sqlFiles.length === 0) return { adapter: 'sql', applied: false, note: 'No .sql files found' };
  const declared = model.elements.filter((e) => !isDeleted(e) && (e.kind === 'table' || e.kind === 'data-entity'));
  const known = new Set(declared.flatMap((e) => [norm(e.name), norm(e.id)]));
  const found = new Map<string, { file: string; line: number; name: string }>();
  for (const file of sqlFiles) {
    const text = await repo.read(file);
    if (text === null) continue;
    for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([`"[]?[\w.]+[`"\]]?(?:\.[`"[]?\w+[`"\]]?)?)/gi)) {
      const name = m[1]!.replace(/[`"[\]]/g, '').split('.').pop()!;
      if (!found.has(norm(name))) found.set(norm(name), { file, line: lineOf(text, m.index), name });
    }
  }
  for (const [key, t] of found) {
    if (!known.has(key)) {
      findings.push({
        adapter: 'sql',
        code: 'undocumented-table',
        status: 'inferred',
        message: `Table "${t.name}" is created in SQL but no table or data entity with that name is declared`,
        evidence: [{ file: t.file, line: t.line }],
      });
    }
  }
  for (const e of declared.filter((x) => x.kind === 'table')) {
    if (!found.has(norm(e.name)) && !found.has(norm(e.id))) {
      findings.push({
        adapter: 'sql',
        code: 'table-not-found',
        status: 'inferred',
        message: `Declared table "${e.name}" is not created in any .sql file (it may be created elsewhere, e.g. by an ORM)`,
        elementId: e.id,
        evidence: sqlFiles.slice(0, 3).map((file) => ({ file })),
      });
    }
  }
  return { adapter: 'sql', applied: true, note: `${sqlFiles.length} .sql file(s), ${found.size} CREATE TABLE statement(s)` };
}

function candidateNames(model: Model, categories: string[]): Set<string> {
  const out = new Set<string>();
  for (const e of model.elements) {
    if (isDeleted(e) || !categories.includes(categoryOf(e.kind))) continue;
    out.add(norm(e.name));
    out.add(norm(e.id));
    for (const c of e.code ?? []) if (c.symbol) out.add(norm(c.symbol));
  }
  return out;
}

async function compose(model: Model, repo: RepoFiles, findings: Finding[]): Promise<AdapterNote> {
  const files = [...repo.files].filter((f) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(f));
  if (files.length === 0) return { adapter: 'compose', applied: false, note: 'No Docker Compose files found' };
  const known = candidateNames(model, ['infrastructure', 'system', 'data']);
  let services = 0;
  for (const file of files) {
    const text = await repo.read(file);
    if (text === null) continue;
    const lc = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lc, schema: 'core' });
    const svc = doc.get('services', true);
    if (!isMap(svc)) continue;
    for (const item of svc.items) {
      if (!isScalar(item.key)) continue;
      const name = String(item.key.value);
      services++;
      if (known.has(norm(name))) continue;
      // Only the service name and location are reported, never its configuration (it may contain secrets).
      findings.push({
        adapter: 'compose',
        code: 'undocumented-service',
        status: 'inferred',
        message: `Compose service "${name}" has no declared element with that name`,
        evidence: [{ file, line: item.key.range ? lc.linePos(item.key.range[0]).line : undefined }],
      });
    }
  }
  return { adapter: 'compose', applied: true, note: `${files.length} Compose file(s), ${services} service(s)` };
}

async function terraform(model: Model, repo: RepoFiles, findings: Finding[]): Promise<AdapterNote> {
  const files = [...repo.files].filter((f) => f.endsWith('.tf'));
  if (files.length === 0) return { adapter: 'terraform', applied: false, note: 'No Terraform files found' };
  const known = candidateNames(model, ['infrastructure', 'data']);
  let resources = 0;
  for (const file of files) {
    const text = await repo.read(file);
    if (text === null) continue;
    for (const m of text.matchAll(/^\s*resource\s+"([^"]+)"\s+"([^"]+)"/gm)) {
      resources++;
      const address = `${m[1]}.${m[2]}`;
      if (known.has(norm(address)) || known.has(norm(m[2]!))) continue;
      findings.push({
        adapter: 'terraform',
        code: 'undocumented-resource',
        status: 'inferred',
        message: `Terraform resource ${address} has no declared infrastructure element (match by name, ID or code symbol "${address}")`,
        evidence: [{ file, line: lineOf(text, m.index) }],
      });
    }
  }
  return { adapter: 'terraform', applied: true, note: `${files.length} Terraform file(s), ${resources} resource(s)` };
}

export async function verifyModel(root: string, model: Model): Promise<VerifyReport> {
  const repo = await listFiles(root);
  const findings: Finding[] = [];
  const adapters: AdapterNote[] = [];
  for (const adapter of [codeRefs, typescript, sql, compose, terraform]) adapters.push(await adapter(model, repo, findings));
  return { findings, adapters, scannedFiles: repo.files.size, truncated: repo.truncated };
}
