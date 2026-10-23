import { useState } from 'react';
import type { AppState } from '../../core/api.js';
import { api, RequestError } from '../api.js';

export function IssuesPanel({ state, onState }: { state: AppState; onState?: (s: AppState) => void }) {
  const [migrating, setMigrating] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const needsMigration = state.issues.some((i) => i.code === 'migration-required');
  const errors = state.issues.filter((i) => i.severity === 'error');
  const warnings = state.issues.filter((i) => i.severity === 'warning');
  if (state.issues.length === 0) return null;
  return (
    <section className={errors.length ? 'issues issues-error' : 'issues issues-warning'} aria-live="polite">
      <strong>
        {errors.length > 0
          ? state.model
            ? `The model files contain ${errors.length} error(s). Showing the last valid version${state.lastValidAt ? ` from ${new Date(state.lastValidAt).toLocaleTimeString()}` : ''}; editing is paused until the files are fixed.`
            : `The model contains ${errors.length} error(s) and no valid version has been loaded yet.`
          : `${warnings.length} warning(s)`}
      </strong>
      {needsMigration && onState && (
        <div className="actions">
          <button
            className="primary"
            disabled={migrating}
            onClick={async () => {
              setMigrating(true);
              setMigrateError(null);
              try {
                onState((await api.post<{ state: AppState }>('/api/migrate')).state);
              } catch (e) {
                setMigrateError(e instanceof RequestError ? e.message : 'Migration failed');
              } finally {
                setMigrating(false);
              }
            }}
          >
            Migrate the model
          </button>
          {migrateError && <span className="error-text">{migrateError}</span>}
        </div>
      )}
      <ul>
        {state.issues.map((i, n) => (
          <li key={n} className={i.severity}>
            <code>
              {i.file ?? '(model)'}
              {i.line !== undefined ? `:${i.line}` : ''}
            </code>
            {i.path && <code> {i.path}</code>} {i.message}
            {i.hint && <div className="hint">{i.hint}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
