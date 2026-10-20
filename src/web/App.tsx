import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import type { AppState } from '../core/api.js';
import { layoutView } from '../core/layout.js';
import { deriveView, listViews, searchElements, VIEW_TYPE_LABELS } from '../core/views.js';
import { subscribeState } from './api.js';
import { Canvas, type Selection } from './components/Canvas.js';
import { DetailPanel } from './components/DetailPanel.js';
import { IssuesPanel } from './components/IssuesPanel.js';
import { RepoPicker } from './components/RepoPicker.js';
import { SequenceView } from './components/SequenceView.js';

const VIEW_KEY = 'archflow:view';

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

  useEffect(() => subscribeState(setState, setConnected), []);
  useEffect(() => {
    try {
      if (viewId) localStorage.setItem(VIEW_KEY, viewId);
    } catch {
      /* storage unavailable: the view simply is not remembered */
    }
  }, [viewId]);

  const model = state?.model ?? null;
  const views = useMemo(() => (model ? listViews(model) : []), [model]);
  const current = views.find((v) => v.view.id === viewId) ?? views[0];
  const derived = useMemo(
    () => (model && current ? deriveView(model, current.view, current.builtin, { showDeleted }) : null),
    [model, current, showDeleted],
  );
  const boxes = useMemo(() => (derived ? layoutView(derived) : {}), [derived]);
  const hits = useMemo(() => (model ? searchElements(model, query) : []), [model, query]);

  if (!state) return <div className="center-page">Connecting to the Archflow service…</div>;
  if (state.status === 'no-repo') return <RepoPicker onOpened={setState} />;

  const currentViewHas =
    !selection || !derived
      ? true
      : selection.type === 'element'
        ? derived.nodes.some((n) => n.id === selection.id)
        : derived.edges.some((e) => e.id === selection.id);

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Archflow</strong>
        <span className="project">{model?.manifest.project.name ?? 'No model loaded'}</span>
        <span className="repo" title={state.repo ?? ''}>
          {state.repo}
        </span>
        <span className={`status status-${state.status}`}>{state.status}</span>
        {!connected && <span className="status status-invalid">service disconnected</span>}
      </header>

      {state.status === 'no-model' ? (
        <div className="center-page">
          <h2>No Archflow model in this repository</h2>
          <p>
            Create <code>.archflow/manifest.yaml</code> as described in the model format documentation. Archflow does not
            generate the architecture from the code.
          </p>
        </div>
      ) : (
        <div className="workspace">
          <nav className="sidebar">
            <input
              type="search"
              placeholder="Find by name, ID or code path"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find elements"
            />
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
          </nav>

          <main className="main">
            <IssuesPanel state={state} />
            {derived && derived.incomplete.length > 0 && (
              <div className="incomplete" role="status">
                <strong>This view is incomplete.</strong>
                <ul>{derived.incomplete.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            <div className="canvas">
              {derived &&
                (derived.view.type === 'sequence' ? (
                  <SequenceView derived={derived} selection={selection} onSelect={setSelection} />
                ) : (
                  <ReactFlowProvider key={derived.view.id}>
                    <Canvas derived={derived} boxes={boxes} selection={selection} onSelect={setSelection} editable={false} />
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
            />
          )}
        </div>
      )}
    </div>
  );
}

