import { useState } from 'react';
import type { AppState } from '../core/api.js';
import type { Box } from '../core/layout.js';
import type { Op } from '../core/ops.js';
import type { DerivedView } from '../core/views.js';
import { BUILTIN_PREFIX } from '../core/views.js';
import { api, RequestError } from './api.js';
import type { Selection } from './components/Canvas.js';
import { Dialog } from './components/Dialog.js';

export type ExtrasDialog = 'view-settings' | 'export' | 'import' | 'verify';

interface DialogsProps {
  which: ExtrasDialog;
  state: AppState;
  derived: DerivedView | null;
  boxes: Record<string, Box>;
  onClose: () => void;
  onState: (s: AppState) => void;
  run: (ops: Op[], done?: string) => Promise<boolean>;
  toast: (text: string, error?: boolean) => void;
  select: (s: Selection) => void;
}

function ViewSettings({ derived, onClose, run }: DialogsProps) {
  const view = derived!.view;
  const [name, setName] = useState(view.name);
  const [description, setDescription] = useState(view.description ?? '');
  const builtin = view.id.startsWith(BUILTIN_PREFIX);
  return (
    <Dialog title="View settings" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            [{ op: 'update', id: view.id, set: { name: name.trim(), description: description.trim() || null } }],
            'View saved',
          );
          if (ok) onClose();
        }}
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {builtin && <p className="muted">This is a default view; saving creates a view file for it.</p>}
        <div className="buttons">
          {!builtin && (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (confirm(`Remove the view "${view.name}"? Only its presentation is removed (recorded in history); elements stay in the model.`)) {
                  if (await run([{ op: 'delete', id: view.id }], 'View removed')) onClose();
                }
              }}
            >
              Remove view
            </button>
          )}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </Dialog>
  );
}

function NoModel({ state, onState }: { state: AppState; onState: (s: AppState) => void }) {
  const [name, setName] = useState(state.repo?.split(/[\\/]/).pop() ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="center-page">
      <h2>No Archflow model in this repository</h2>
      <p>
        Archflow does not generate the architecture from the code. Create an empty model and then declare elements here, or let
        Claude Code declare them with the Archflow skill.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            onState(await api.post<AppState>('/api/init', { name: name.trim() }));
          } catch (err) {
            setError(err instanceof RequestError ? err.message : 'Could not reach the Archflow service.');
          }
        }}
      >
        <input aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" className="primary">Create empty model</button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

/** Downloads a server-side export; returns the warning header, if any. */
async function fetchDownload(url: string): Promise<{ blob: Blob; name: string; warning?: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Export failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export';
  const warning = res.headers.get('x-archflow-warning');
  return { blob: await res.blob(), name, ...(warning ? { warning: decodeURIComponent(warning) } : {}) };
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** PNG is rasterized in the browser from the same SVG the server exports. */
async function svgToPng(svg: Blob, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(svg);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The SVG could not be rendered for PNG export.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(img.width * scale);
    canvas.height = Math.ceil(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ExportDialog({ derived, onClose, toast }: DialogsProps) {
  const [busy, setBusy] = useState(false);
  const view = derived?.view;
  const run = async (kind: string) => {
    setBusy(true);
    try {
      if (kind === 'json' || kind === 'yaml') {
        const d = await fetchDownload(`/api/export/model?format=${kind}`);
        save(d.blob, d.name);
      } else if (kind === 'png') {
        const d = await fetchDownload(`/api/export/view?view=${encodeURIComponent(view!.id)}&format=svg`);
        save(await svgToPng(d.blob), d.name.replace(/\.svg$/, '.png'));
      } else {
        const d = await fetchDownload(`/api/export/view?view=${encodeURIComponent(view!.id)}&format=${kind}`);
        save(d.blob, d.name);
        if (d.warning) toast(d.warning, true);
      }
      onClose();
    } catch (e) {
      // Export errors never affect the model.
      toast(e instanceof Error ? e.message : 'Export failed', true);
    } finally {
      setBusy(false);
    }
  };
  const sequence = view?.type === 'sequence';
  return (
    <Dialog title="Export" onClose={onClose}>
      <h3>Whole model</h3>
      <p className="muted">Native format with IDs, documentation, provenance, views and file layout.</p>
      <div className="actions">
        <button disabled={busy} onClick={() => run('json')}>Archflow JSON</button>
        <button disabled={busy} onClick={() => run('yaml')}>Archflow YAML</button>
      </div>
      {view && (
        <>
          <h3>Current view: {view.name}</h3>
          <div className="actions">
            <button disabled={busy} onClick={() => run('svg')}>SVG</button>
            <button disabled={busy} onClick={() => run('png')}>PNG</button>
            <button disabled={busy} onClick={() => run('pdf')}>PDF</button>
            <button disabled={busy} onClick={() => run('mermaid')}>Mermaid</button>
            <button disabled={busy || sequence} title={sequence ? 'Sequence views cannot be exported to draw.io' : undefined} onClick={() => run('drawio')}>
              draw.io
            </button>
          </div>
          <p className="muted">Images and PDF use the saved layout. PDF text is limited to Latin-1 characters; others are replaced and reported.</p>
        </>
      )}
      <div className="buttons">
        <button onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

interface Preview {
  mode: 'replace' | 'merge';
  summary: { added: string[]; changed: string[]; markedDeleted: string[]; unchanged: number; reused: string[] };
  warnings: string[];
  issues: AppState['issues'];
  valid: boolean;
  files: { file: string; change: string }[];
  baseVersion: string;
}

const FORMATS: { value: string; label: string; ext: RegExp }[] = [
  { value: 'archflow-json', label: 'Archflow JSON (replaces the model)', ext: /\.json$/i },
  { value: 'archflow-yaml', label: 'Archflow YAML (replaces the model)', ext: /\.ya?ml$/i },
  { value: 'mermaid', label: 'Mermaid flowchart / sequence (adds to the model)', ext: /\.(mmd|mermaid|md)$/i },
  { value: 'drawio', label: 'draw.io (adds to the model)', ext: /\.(drawio|xml)$/i },
];

function ImportDialog({ onClose, onState, toast }: DialogsProps) {
  const [format, setFormat] = useState('mermaid');
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = { format, content: file?.content ?? '', fileName: file?.name ?? 'import' };
  const list = (label: string, ids: string[]) =>
    ids.length > 0 && (
      <li>
        {label}: {ids.length} <span className="muted">({ids.slice(0, 12).join(', ')}{ids.length > 12 ? '…' : ''})</span>
      </li>
    );
  return (
    <Dialog title="Import" onClose={onClose} wide>
      <label>
        Format
        <select value={format} onChange={(e) => (setFormat(e.target.value), setPreview(null))}>
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </label>
      <label>
        File
        <input
          type="file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setPreview(null);
            setError(null);
            if (!f) return setFile(null);
            const match = FORMATS.find((x) => x.ext.test(f.name));
            if (match) setFormat(match.value);
            setFile({ name: f.name, content: await f.text() });
          }}
        />
      </label>
      <div className="actions">
        <button
          disabled={!file || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setPreview(await api.post<Preview>('/api/import/preview', request));
            } catch (e) {
              setError(e instanceof RequestError ? e.message : 'Preview failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          Preview
        </button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {preview && (
        <div className="import-preview">
          <h3>{preview.mode === 'replace' ? 'Replace the model' : 'Add to the model'}</h3>
          <ul>
            {list('New', preview.summary.added)}
            {list('Changed', preview.summary.changed)}
            {list('Linked to existing elements', preview.summary.reused)}
            {list('Not in the import, will be marked as deleted', preview.summary.markedDeleted)}
            <li>Files: {preview.files.map((f) => `${f.file} (${f.change})`).join(', ') || 'none'}</li>
          </ul>
          {preview.warnings.length > 0 && (
            <div className="warning-list">
              <strong>Review before applying</strong>
              <ul>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {!preview.valid && (
            <div className="issues issues-error">
              <strong>The result would be invalid; it cannot be applied.</strong>
              <ul>
                {preview.issues.filter((i) => i.severity === 'error').map((i, n) => (
                  <li key={n}><code>{i.file}{i.path ? ` ${i.path}` : ''}</code> {i.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="buttons">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={!preview?.valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              onState(await api.post<AppState>('/api/import/apply', { ...request, baseVersion: preview!.baseVersion }));
              toast('Imported. The change is in the history and can be restored.');
              onClose();
            } catch (e) {
              setError(e instanceof RequestError ? e.message : 'Import failed');
              setPreview(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          Apply import
        </button>
      </div>
    </Dialog>
  );
}

interface Finding {
  adapter: string;
  code: string;
  status: 'verified' | 'inferred';
  message: string;
  elementId?: string;
  evidence: { file: string; line?: number }[];
}
interface Report {
  findings: Finding[];
  adapters: { adapter: string; applied: boolean; note: string }[];
  scannedFiles: number;
  truncated: boolean;
}

function VerifyDialog({ onClose, select }: DialogsProps) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Verify the model against the code" onClose={onClose} wide>
      <p className="muted">
        Bounded checks for code references, TypeScript/JavaScript imports, SQL tables, Docker Compose services and Terraform resources.
        Results are never applied automatically: review them and declare the changes yourself (or ask Claude).
      </p>
      <div className="actions">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setReport(await api.post<Report>('/api/verify'));
            } catch (e) {
              setError(e instanceof RequestError ? e.message : 'Verification failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Checking…' : report ? 'Run again' : 'Run checks'}
        </button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {report && (
        <>
          <ul className="muted">
            {report.adapters.map((a) => <li key={a.adapter}>{a.adapter}: {a.note}</li>)}
            {report.truncated && <li>Only the first {report.scannedFiles} files were scanned.</li>}
          </ul>
          {report.findings.length === 0 ? (
            <p>No discrepancies found by the available checks.</p>
          ) : (
            <ul className="findings">
              {report.findings.map((f, i) => (
                <li key={i}>
                  <span className={`badge badge-${f.status === 'verified' ? 'verified' : 'inferred'}`}>{f.status === 'verified' ? 'observed' : 'inferred'}</span>{' '}
                  {f.message}
                  {f.elementId && (
                    <> · <a onClick={() => (select({ type: 'element', id: f.elementId! }), onClose())}>show element</a></>
                  )}
                  <div className="muted">
                    {f.adapter}/{f.code} · {f.evidence.map((e) => (e.line ? `${e.file}:${e.line}` : e.file)).join(', ')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="buttons">
        <button onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export const Extras = {
  Buttons: ({ state, editable, open }: { state: AppState; editable: boolean; open: (which: ExtrasDialog) => void }) => (
    <>
      <button disabled={!state.model} onClick={() => open('export')}>Export</button>
      <button disabled={!editable} onClick={() => open('import')}>Import</button>
      <button disabled={!state.model} onClick={() => open('verify')}>Verify</button>
    </>
  ),
  NoModel,
  Dialogs: (props: DialogsProps) => {
    switch (props.which) {
      case 'view-settings':
        return <ViewSettings {...props} />;
      case 'export':
        return <ExportDialog {...props} />;
      case 'import':
        return <ImportDialog {...props} />;
      case 'verify':
        return <VerifyDialog {...props} />;
    }
  },
};
