import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppState } from '../core/api.js';
import { hashValue } from '../core/hash.js';
import { layoutView } from '../core/layout.js';
import { isDeleted, type Model } from '../core/model.js';
import { entityHash, type Conflict, type Op, type OpsResult } from '../core/ops.js';
import { ICONS, SHAPES, type Element, type Relation } from '../core/schema.js';
import { iconFor } from './components/icons.js';
import { BUILTIN_PREFIX, deriveView, listViews, searchElements, VIEW_TYPE_LABELS } from '../core/views.js';
import { api, RequestError, subscribeState } from './api.js';
import { Canvas, type LayoutEntry, type Selection } from './components/Canvas.js';
import { DetailPanel } from './components/DetailPanel.js';
import { Dialog } from './components/Dialog.js';
import { ElementForm, NoteForm, RelationForm } from './components/forms.js';
import { HistoryPanel } from './components/HistoryPanel.js';
import { IssuesPanel } from './components/IssuesPanel.js';
import { RepoPicker } from './components/RepoPicker.js';
import { SequenceView } from './components/SequenceView.js';
import { Extras, type ExtrasDialog } from './extras.js';

const VIEW_KEY = 'archflow:view';

type DialogState =
  | null
  /** `expected` is captured when the dialog opens, so edits made meanwhile on disk are detected. */
  | { kind: 'element'; element?: Element; defaults?: Partial<Element>; expected?: string }
  | { kind: 'relation'; relation?: Relation; defaults?: Partial<Relation>; expected?: string }
  | { kind: 'note'; id: string; entity: Element | Relation; expected?: string }
  | { kind: 'history' }
  | { kind: 'free-view' }
  | { kind: 'conflict'; conflicts: Conflict[]; retry: Op[] }
  | { kind: 'extras'; which: ExtrasDialog };

const today = () => new Date().toISOString().slice(0, 10);

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(true);
  const [viewId, setViewId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(VIEW_KEY);
    } catch {
      return null;
    }
  });
  const [selection, setSelection] = useState<Selection>(null);
  const [query, setQuery] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => subscribeState(setState, setConnected), []);
  useEffect(() => {
    try {
      if (viewId) localStorage.setItem(VIEW_KEY, viewId);
    } catch {
      /* storage unavailable: the view simply is not remembered */
    }
  }, [viewId]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 8000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const model = state?.model ?? null;
  const views = useMemo(() => (model ? listViews(model) : []), [model]);
  const current = views.find((v) => v.view.id === viewId) ?? views[0];
  const derived = useMemo(
    () => (model && current ? deriveView(model, current.view, current.builtin, { showDeleted }) : null),
    [model, current, showDeleted],
  );
  const boxes = useMemo(() => (derived ? layoutView(derived) : {}), [derived]);
  const hits = useMemo(() => (model ? searchElements(model, query) : []), [model, query]);
  const editable = state?.status === 'valid' && connected;

  /** Sends operations; conflicts and invalid results are shown, never silently resolved. */
  const run = useCallback(
    async (ops: Op[], done?: string): Promise<boolean> => {
      try {
        const res = await api.post<OpsResult>('/api/ops', { ops });
        setState(res.state);
        const created = current && res.createdViews[current.view.id];
        if (created) setViewId(created);
        if (done) setToast({ text: done });
        return true;
      } catch (err) {
        if (err instanceof RequestError && err.body.error === 'conflict') {
          const conflicts = (err.body.conflicts ?? []) as Conflict[];
          // "Apply anyway" re-sends the same operations without the version checks, after review.
          const retry = ops.map((op) => {
            const { expected: _ignored, ...rest } = op as Op & { expected?: unknown };
            return rest as Op;
          });
          setDialog({ kind: 'conflict', conflicts, retry });
        } else if (err instanceof RequestError) {
          const issues = err.body.issues?.slice(0, 3).map((i) => `${i.file ?? ''}${i.path ? ` ${i.path}` : ''}: ${i.message}`) ?? [];
          setToast({ text: [err.message, ...issues].join('\n'), error: true });
        } else {
          setToast({ text: 'Could not reach the Archflow service.', error: true });
        }
        return false;
      }
    },
    [current],
  );

  const onLayout = useCallback(
    (entries: Record<string, LayoutEntry>) => {
      if (!derived) return;
      const saved = derived.view.layout ?? {};
      const expected = Object.fromEntries(Object.keys(entries).map((id) => [id, hashValue(saved[id] ?? null)]));
      void run([{ op: 'layout', view: derived.view.id, entries, expected }]);
    },
    [derived, run],
  );

  if (!state) return <div className="center-page">Connecting to the Archflow service…</div>;
  if (state.status === 'no-repo') return <RepoPicker onOpened={setState} />;

  const inView = (id: string) => !!derived?.nodes.some((n) => n.id === id);
  const currentViewHas =
    !selection || !derived ? true : selection.type === 'element' ? inView(selection.id) : derived.edges.some((e) => e.id === selection.id);

  const close = () => setDialog(null);

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Archflow</strong>
        <span className="project">{model?.manifest.project.name ?? 'No model loaded'}</span>
        <span className="repo" title={state.repo ?? ''}>{state.repo}</span>
        <span className={`status status-${state.status}`}>{state.status}</span>
        {!connected && <span className="status status-invalid">service disconnected</span>}
        <span className="spacer" />
        {model && (
          <div className="toolbar">
            <button disabled={!editable} onClick={() => setDialog({ kind: 'element', defaults: {} })}>+ Element</button>
            <button disabled={!editable} onClick={() => setDialog({ kind: 'relation', defaults: {} })}>+ Relation</button>
            <button disabled={!editable} onClick={() => setDialog({ kind: 'free-view' })}>+ Free view</button>
            <button onClick={() => setDialog({ kind: 'history' })}>History</button>
            <Extras.Buttons state={state} editable={editable} open={(which) => setDialog({ kind: 'extras', which })} />
          </div>
        )}
      </header>

      {state.status === 'no-model' ? (
        <Extras.NoModel state={state} onState={setState} />
      ) : (
        <div className="workspace">
          <nav className="sidebar">
            <input type="search" placeholder="Find by name, ID or code path" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find elements" />
            {query && (
              <ul className="hits">
                {hits.length === 0 && <li className="muted">No matches</li>}
                {hits.map((h) => (
                  <li key={h.id}>
                    <a onClick={() => setSelection({ type: 'element', id: h.id })}>
                      {h.name} <span className="muted">{h.kind} · {h.matched}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <h3>Views</h3>
            <ul className="views">
              {views.map(({ view, builtin }) => (
                <li key={view.id} className={view.id === current?.view.id ? 'active' : ''}>
                  <a onClick={() => setViewId(view.id)}>
                    {view.name}
                    <span className="muted"> {VIEW_TYPE_LABELS[view.type]}{builtin ? ' · default' : ''}</span>
                  </a>
                </li>
              ))}
            </ul>
            <label className="toggle">
              <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted
            </label>
            {derived && editable && derived.view.type !== 'sequence' && Object.keys(derived.view.layout ?? {}).length > 0 && (
              <button
                className="block"
                onClick={() =>
                  confirm('Discard the saved positions of this view and use the automatic layout?') &&
                  run(
                    [{ op: 'layout', view: derived.view.id, entries: Object.fromEntries(Object.keys(derived.view.layout ?? {}).map((id) => [id, null])) }],
                    'Automatic layout applied',
                  )
                }
              >
                Reset to automatic layout
              </button>
            )}
            {derived && editable && derived.view.type !== 'sequence' && (
              <button className="block" onClick={() => setDialog({ kind: 'extras', which: 'view-settings' })}>
                View settings
              </button>
            )}
          </nav>

          <main className="main">
            <IssuesPanel state={state} />
            {derived && derived.incomplete.length > 0 && (
              <div className="incomplete" role="status">
                <strong>This view is incomplete.</strong>
                <ul>{derived.incomplete.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            <div className="canvas" id="canvas">
              {derived &&
                (derived.view.type === 'sequence' ? (
                  <SequenceView derived={derived} selection={selection} onSelect={setSelection} />
                ) : (
                  <ReactFlowProvider key={derived.view.id}>
                    <Canvas
                      derived={derived}
                      boxes={boxes}
                      selection={selection}
                      onSelect={setSelection}
                      editable={editable && !derived.flow}
                      onLayout={onLayout}
                      onConnect={(from, to) => setDialog({ kind: 'relation', defaults: { from, to } })}
                    />
                  </ReactFlowProvider>
                ))}
            </div>
          </main>

          {model && (
            <DetailPanel
              model={model}
              selection={selection}
              onSelect={setSelection}
              onOpenView={setViewId}
              currentViewHas={currentViewHas}
              actions={
                editable && selection ? (
                  <SelectionActions
                    model={model}
                    selection={selection}
                    viewId={derived?.view.id}
                    viewIsFree={derived?.view.type === 'free'}
                    viewStyles={derived?.view.styles ?? {}}
                    inView={selection.type === 'element' && inView(selection.id)}
                    view={derived?.view}
                    run={run}
                    edit={() => {
                      const expected = entityHash(model, selection.id);
                      if (selection.type === 'element') setDialog({ kind: 'element', element: model.elements.find((e) => e.id === selection.id), expected });
                      else setDialog({ kind: 'relation', relation: model.relations.find((r) => r.id === selection.id), expected });
                    }}
                    note={() => {
                      const entity = (model.elements.find((e) => e.id === selection.id) ?? model.relations.find((r) => r.id === selection.id))!;
                      setDialog({ kind: 'note', id: selection.id, entity, expected: entityHash(model, selection.id) });
                    }}
                  />
                ) : undefined
              }
            />
          )}
        </div>
      )}

      {dialog?.kind === 'element' && model && (
        <ElementForm
          model={model}
          element={dialog.element}
          defaults={dialog.defaults}
          onCancel={close}
          onSubmit={async (value) => {
            const el = dialog.element;
            const ops: Op[] = el
              ? [{ op: 'update', id: el.id, set: value, expected: dialog.expected }]
              : [{ op: 'create', entity: 'element', value }];
            // New elements appear in a free view only when explicitly included.
            if (!el && derived?.view.type === 'free') {
              ops.push({ op: 'update', id: derived.view.id, set: { include: [...(derived.view.include ?? []), value.id] } });
            }
            if (Object.keys(value).length === 0 || (await run(ops, el ? 'Saved' : 'Element created'))) {
              close();
              if (!el) setSelection({ type: 'element', id: value.id as string });
            }
          }}
        />
      )}
      {dialog?.kind === 'relation' && model && (
        <RelationForm
          model={model}
          relation={dialog.relation}
          defaults={dialog.defaults}
          onCancel={close}
          onSubmit={async (value) => {
            const r = dialog.relation;
            const ops: Op[] = r
              ? [{ op: 'update', id: r.id, set: value, expected: dialog.expected }]
              : [{ op: 'create', entity: 'relation', value }];
            if (Object.keys(value).length === 0 || (await run(ops, r ? 'Saved' : 'Relation created'))) close();
          }}
        />
      )}
      {dialog?.kind === 'note' && model && (
        <NoteForm
          onCancel={close}
          onSubmit={async (note) => {
            const notes = [...(dialog.entity.notes ?? []), { ...note, date: today() }];
            if (await run([{ op: 'update', id: dialog.id, set: { notes }, expected: dialog.expected }], 'Note added')) close();
          }}
        />
      )}
      {dialog?.kind === 'free-view' && model && <FreeViewForm model={model} onCancel={close} run={run} onCreated={(id) => (setViewId(id), close())} />}
      {dialog?.kind === 'history' && <HistoryPanel version={state.version} onClose={close} onRestored={(s) => (setState(s), setToast({ text: 'Restored' }))} />}
      {dialog?.kind === 'conflict' && (
        <Dialog title="Conflicting change" onClose={close}>
          <p>
            Someone else (for example Claude or a text editor) changed the same data after you loaded it. Nothing was written.
            Review the current values before deciding.
          </p>
          {dialog.conflicts.map((c) => (
            <div key={c.id}>
              <strong>{c.message}</strong>
              <pre className="diff">{c.current === undefined ? '(absent)' : JSON.stringify(c.current, null, 2)}</pre>
            </div>
          ))}
          <div className="buttons">
            <button onClick={close}>Keep their version</button>
            <button
              className="danger"
              onClick={async () => {
                if (await run(dialog.retry, 'Your change was applied over theirs')) close();
              }}
            >
              Apply mine over theirs
            </button>
          </div>
        </Dialog>
      )}
      {dialog?.kind === 'extras' && (
        <Extras.Dialogs
          which={dialog.which}
          state={state}
          derived={derived}
          boxes={boxes}
          onClose={close}
          onState={setState}
          run={run}
          toast={(text, error) => setToast({ text, error })}
          select={setSelection}
        />
      )}
      {toast && <div className={toast.error ? 'toast error' : 'toast'} role="status">{toast.text}</div>}
    </div>
  );
}

function SelectionActions(props: {
  model: Model;
  selection: NonNullable<Selection>;
  viewId?: string;
  viewIsFree: boolean;
  viewStyles: Record<string, { color?: string; shape?: string; icon?: string }>;
  inView: boolean;
  view?: { id: string; include?: string[]; exclude?: string[] };
  run: (ops: Op[], done?: string) => Promise<boolean>;
  edit: () => void;
  note: () => void;
}) {
  const { model, selection, run, view } = props;
  const entity =
    selection.type === 'element' ? model.elements.find((e) => e.id === selection.id) : model.relations.find((r) => r.id === selection.id);
  if (!entity) return null;
  const deleted = isDeleted(entity);
  const expected = entityHash(model, entity.id);
  const style = props.viewStyles[entity.id] ?? {};
  const setStyle = (next: Record<string, string | undefined>) => {
    const clean = Object.fromEntries(Object.entries({ ...style, ...next }).filter(([, v]) => v));
    void run([{ op: 'style', view: props.viewId!, element: entity.id, style: Object.keys(clean).length ? clean : null, expected: hashValue(props.viewStyles[entity.id] ?? null) }]);
  };
  const membership = () => {
    if (!view) return;
    const include = new Set(view.include ?? []);
    const exclude = new Set(view.exclude ?? []);
    if (props.inView) {
      include.delete(entity.id);
      if (!props.viewIsFree) exclude.add(entity.id);
    } else {
      exclude.delete(entity.id);
      include.add(entity.id);
    }
    const list = (s: Set<string>) => (s.size ? [...s] : null);
    void run([{ op: 'update', id: view.id, set: { include: list(include), exclude: list(exclude) } }], props.inView ? 'Hidden from this view' : 'Shown in this view');
  };
  return (
    <div>
      <div className="actions">
        {!deleted && <button onClick={props.edit}>Edit</button>}
        {!deleted && <button onClick={props.note}>Add note</button>}
        {deleted ? (
          <button onClick={() => run([{ op: 'restore', id: entity.id, expected }], 'Restored')}>Restore</button>
        ) : (
          <button
            className="danger"
            onClick={() => {
              const reason = prompt(`Delete "${entity.id}"? It is kept as deleted in the model and can be restored.\nReason (optional):`);
              if (reason !== null) void run([{ op: 'delete', id: entity.id, expected, ...(reason.trim() ? { reason: reason.trim() } : {}) }], 'Deleted (restorable)');
            }}
          >
            Delete
          </button>
        )}
        {selection.type === 'element' && view && !view.id.startsWith(`${BUILTIN_PREFIX}sequence`) && !deleted && (
          <button onClick={membership}>{props.inView ? 'Hide from this view' : 'Show in this view'}</button>
        )}
      </div>
      {selection.type === 'element' && props.inView && props.viewId && !deleted && (
        <div className="style-row">
          <span className="muted">Style in this view:</span>
          <input type="color" aria-label="Color" value={style.color ?? '#0969da'} onChange={(e) => setStyle({ color: e.target.value })} />
          <select aria-label="Shape" value={style.shape ?? ''} onChange={(e) => setStyle({ shape: e.target.value || undefined })}>
            <option value="">default shape</option>
            {SHAPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <IconPreview kind={'kind' in entity ? entity.kind : undefined} icon={style.icon} />
          <select aria-label="Icon" value={style.icon ?? ''} onChange={(e) => setStyle({ icon: e.target.value || undefined })}>
            <option value="">icon of the kind</option>
            {ICONS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
          {(style.color || style.shape || style.icon) && <button onClick={() => setStyle({ color: undefined, shape: undefined, icon: undefined })}>Reset</button>}
        </div>
      )}
    </div>
  );
}

function IconPreview({ kind, icon }: { kind?: Element['kind']; icon?: string }) {
  if (!kind) return null;
  const Icon = iconFor(kind, icon);
  return <Icon size={18} aria-hidden="true" className="icon-preview" />;
}

function FreeViewForm({ model, onCancel, run, onCreated }: { model: Model; onCancel: () => void; run: (ops: Op[], done?: string) => Promise<boolean>; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Dialog title="New free view" onClose={onCancel}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const base = `view-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'free'}`;
          let id = base;
          for (let i = 2; model.sources[id]; i++) id = `${base}-${i}`;
          if (await run([{ op: 'create', entity: 'view', value: { id, name: name.trim(), type: 'free' } }], 'View created')) onCreated(id);
        }}
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <p className="muted">A free view starts empty. Select elements (search or other views) and use "Show in this view".</p>
        <div className="buttons">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary">Create</button>
        </div>
      </form>
    </Dialog>
  );
}
