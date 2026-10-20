import { useEffect, useState } from 'react';
import { diffLines } from '../../core/diff.js';
import type { AppState, HistoryEntry, HistorySummary } from '../../core/api.js';
import { api, RequestError } from '../api.js';
import { Dialog } from './Dialog.js';

export function HistoryPanel({ onClose, onRestored, version }: { onClose: () => void; onRestored: (s: AppState) => void; version: string | null }) {
  const [list, setList] = useState<HistorySummary[] | null>(null);
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<HistorySummary[]>('/api/history').then(setList, (e) => setError(e instanceof RequestError ? e.message : 'Could not load history'));
  }, [version]);

  const restore = async (id: string) => {
    if (!confirm('Restore the model to the state before this change? Every later change is undone; the restoration itself is recorded and can be undone too.')) return;
    try {
      onRestored(await api.post<AppState>(`/api/history/${id}/restore`));
      setEntry(null);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : 'Restore failed');
    }
  };

  return (
    <Dialog title="History" onClose={onClose} wide>
      {error && <p className="error-text" role="alert">{error}</p>}
      {!list && !error && <p>Loading…</p>}
      {list && list.length === 0 && <p className="muted">No changes recorded yet. Changes made in Archflow and valid edits detected on disk appear here.</p>}
      <div className="history">
        <ul className="history-list">
          {list?.map((h) => (
            <li key={h.id} className={entry?.id === h.id ? 'active' : ''}>
              <a onClick={() => api.get<HistoryEntry>(`/api/history/${h.id}`).then(setEntry, () => setError('Could not load entry'))}>
                <div>{h.summary}</div>
                <div className="muted">
                  {new Date(h.at).toLocaleString()} · {h.origin} · {h.files.join(', ')}
                </div>
              </a>
            </li>
          ))}
        </ul>
        {entry && (
          <div className="history-detail">
            <div className="actions">
              <button className="danger" onClick={() => restore(entry.id)}>
                Restore state before this change
              </button>
            </div>
            {entry.changes.map((c) => (
              <div key={c.file}>
                <h4>
                  <code>{c.file}</code> {c.before === null ? '(created)' : c.after === null ? '(removed)' : ''}
                </h4>
                <pre className="diff">
                  {diffLines(c.before ?? '', c.after ?? '').map((l, i) => (
                    <div key={i} className={`diff-${l.kind}`}>
                      {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
                      {l.text}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
