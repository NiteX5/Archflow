import { useMemo, useState } from 'react';
import type { Model } from '../../core/model.js';
import { suggestId } from '../../core/ops.js';
import {
  ELEMENT_KINDS,
  PROVENANCE_SOURCES,
  RELATION_TYPES,
  VERIFICATION_STATUSES,
  type Element,
  type Provenance,
  type Relation,
} from '../../core/schema.js';
import { Dialog, lines } from './Dialog.js';

/** Form state for provenance; empty source means "not documented" (field removed). */
interface ProvState {
  source: string;
  status: string;
  evidence: string;
  verifiedAt: string;
}

const provToState = (p?: Provenance): ProvState => ({
  source: p?.source ?? '',
  status: p?.status ?? 'pending-review',
  evidence: (p?.evidence ?? []).map((e) => (e.ref ? `${e.description} | ${e.ref}` : e.description)).join('\n'),
  verifiedAt: p?.verifiedAt ?? '',
});

const stateToProv = (s: ProvState, previous?: Provenance): Provenance | null => {
  if (!s.source) return null;
  const evidence = lines(s.evidence).map((l) => {
    const [description, ref] = l.split('|').map((x) => x.trim());
    return ref ? { description: description!, ref } : { description: description! };
  });
  return {
    source: s.source as Provenance['source'],
    status: s.status as Provenance['status'],
    ...(evidence.length ? { evidence } : {}),
    ...(s.verifiedAt ? { verifiedAt: s.verifiedAt } : {}),
    ...(previous?.verifiedRevision ? { verifiedRevision: previous.verifiedRevision } : {}),
  };
};

function ProvenanceInputs({ value, onChange }: { value: ProvState; onChange: (v: ProvState) => void }) {
  return (
    <fieldset>
      <legend>Provenance</legend>
      <label>
        Source
        <select value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value })}>
          <option value="">Not documented</option>
          {PROVENANCE_SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      {value.source && (
        <>
          <label>
            Verification status
            <select value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value })}>
              {VERIFICATION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Evidence (one per line, "description | path or URL")
            <textarea rows={3} value={value.evidence} onChange={(e) => onChange({ ...value, evidence: e.target.value })} />
          </label>
          <label>
            Verified at (YYYY-MM-DD)
            <input value={value.verifiedAt} onChange={(e) => onChange({ ...value, verifiedAt: e.target.value })} placeholder="optional" />
          </label>
        </>
      )}
    </fieldset>
  );
}

type FieldPatch = Record<string, unknown>;

/** Sets changed fields and removes cleared optional fields (null), so nothing is invented. */
function diffPatch(before: Record<string, unknown>, after: Record<string, unknown>): FieldPatch {
  const patch: FieldPatch = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) patch[key] = b === undefined ? null : b;
  }
  return patch;
}

const opt = (v: string) => (v.trim() ? v.trim() : undefined);

export function ElementForm({
  model,
  element,
  defaults,
  onCancel,
  onSubmit,
}: {
  model: Model;
  element?: Element;
  defaults?: Partial<Element>;
  onCancel: () => void;
  /** For a new element: the full value. For an edit: only the changed fields. */
  onSubmit: (value: Record<string, unknown>) => void;
}) {
  const base = element ?? (defaults as Element | undefined);
  const taken = useMemo(() => new Set(Object.keys(model.sources)), [model]);
  const [name, setName] = useState(base?.name ?? '');
  const [id, setId] = useState(element?.id ?? '');
  const [idTouched, setIdTouched] = useState(false);
  const [kind, setKind] = useState<string>(base?.kind ?? 'component');
  const [description, setDescription] = useState(base?.description ?? '');
  const [responsibility, setResponsibility] = useState(base?.responsibility ?? '');
  const [parent, setParent] = useState(base?.parent ?? '');
  const [tags, setTags] = useState((base?.tags ?? []).join(', '));
  const [code, setCode] = useState(
    (base?.code ?? []).map((c) => `${c.path}${c.line ? `:${c.line}` : ''}${c.symbol ? ` ${c.symbol}` : ''}`).join('\n'),
  );
  const [rules, setRules] = useState((base?.rules ?? []).join('\n'));
  const [prov, setProv] = useState(provToState(base?.provenance));

  const effectiveId = element ? element.id : idTouched ? id : name ? suggestIdStable(name, taken) : '';

  const submit = () => {
    const value: Record<string, unknown> = {
      id: effectiveId,
      kind,
      name: name.trim(),
      description: opt(description),
      responsibility: opt(responsibility),
      parent: opt(parent),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      code: lines(code).map((l) => {
        const m = /^(\S+?)(?::(\d+))?(?:\s+(\S+))?$/.exec(l);
        return m ? { path: m[1], ...(m[2] ? { line: Number(m[2]) } : {}), ...(m[3] ? { symbol: m[3] } : {}) } : { path: l };
      }),
      rules: lines(rules),
      provenance: stateToProv(prov, base?.provenance) ?? undefined,
    };
    for (const k of ['tags', 'code', 'rules']) if ((value[k] as unknown[]).length === 0) value[k] = undefined;
    if (!element) {
      onSubmit(Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)));
      return;
    }
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(value)) before[k] = (element as Record<string, unknown>)[k];
    onSubmit(diffPatch(before, value));
  };

  const parents = model.elements.filter((e) => e.id !== element?.id && e.lifecycle !== 'deleted');
  return (
    <Dialog title={element ? `Edit ${element.name}` : 'New element'} onClose={onCancel}>
      <form onSubmit={(e) => (e.preventDefault(), submit())}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          ID {element ? '(stable, cannot be changed)' : '(stable; suggested from the name plus a random suffix)'}
          <input
            value={effectiveId}
            disabled={!!element}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
            pattern="[a-z][a-z0-9]*([\-_.][a-z0-9]+)*"
            required
          />
        </label>
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(ELEMENT_KINDS).map(([cat, kinds]) => (
              <optgroup key={cat} label={cat}>
                {kinds.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Parent (grouping)
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">None</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Responsibility
          <textarea rows={2} value={responsibility} onChange={(e) => setResponsibility(e.target.value)} />
        </label>
        <label>
          Business rules (one per line)
          <textarea rows={2} value={rules} onChange={(e) => setRules(e.target.value)} />
        </label>
        <label>
          Code references (one per line: "path[:line] [symbol]", relative to the repository)
          <textarea rows={2} value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label>
          Tags (comma separated)
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <ProvenanceInputs value={prov} onChange={setProv} />
        <div className="buttons">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary">{element ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Keeps the suggested ID stable while the user types the same name. */
const suggestionCache = new Map<string, string>();
function suggestIdStable(name: string, taken: Set<string>): string {
  const cached = suggestionCache.get(name);
  if (cached && !taken.has(cached)) return cached;
  const id = suggestId(name, (x) => taken.has(x));
  suggestionCache.set(name, id);
  return id;
}

export function RelationForm({
  model,
  relation,
  defaults,
  onCancel,
  onSubmit,
}: {
  model: Model;
  relation?: Relation;
  defaults?: Partial<Relation>;
  onCancel: () => void;
  onSubmit: (value: Record<string, unknown>) => void;
}) {
  const base = relation ?? (defaults as Relation | undefined);
  const taken = useMemo(() => new Set(Object.keys(model.sources)), [model]);
  const [type, setType] = useState<string>(base?.type ?? 'depends-on');
  const [from, setFrom] = useState(base?.from ?? '');
  const [to, setTo] = useState(base?.to ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [prov, setProv] = useState(provToState(base?.provenance));
  const elements = model.elements.filter((e) => e.lifecycle !== 'deleted');

  const submit = () => {
    const value: Record<string, unknown> = {
      type,
      from,
      to,
      description: opt(description),
      provenance: stateToProv(prov, base?.provenance) ?? undefined,
    };
    if (!relation) {
      const id = suggestId(`rel-${from}-${type}`, (x) => taken.has(x));
      onSubmit(Object.fromEntries(Object.entries({ id, ...value }).filter(([, v]) => v !== undefined)));
      return;
    }
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(value)) before[k] = (relation as Record<string, unknown>)[k];
    onSubmit(diffPatch(before, value));
  };

  const select = (value: string, set: (v: string) => void, label: string) => (
    <label>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} required>
        <option value="">Choose…</option>
        {elements.map((e) => (
          <option key={e.id} value={e.id}>{e.name} ({e.id})</option>
        ))}
      </select>
    </label>
  );

  return (
    <Dialog title={relation ? `Edit relation ${relation.id}` : 'New relation'} onClose={onCancel}>
      <form onSubmit={(e) => (e.preventDefault(), submit())}>
        {select(from, setFrom, 'From')}
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        {select(to, setTo, 'To')}
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <ProvenanceInputs value={prov} onChange={setProv} />
        <div className="buttons">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!from || !to}>{relation ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function NoteForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (note: { text: string; author?: string }) => void }) {
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('');
  return (
    <Dialog title="Add note" onClose={onCancel}>
      <form onSubmit={(e) => (e.preventDefault(), onSubmit({ text: text.trim(), ...(author.trim() ? { author: author.trim() } : {}) }))}>
        <label>
          Note
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} required autoFocus />
        </label>
        <label>
          Author (optional)
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <div className="buttons">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!text.trim()}>Add</button>
        </div>
      </form>
    </Dialog>
  );
}
