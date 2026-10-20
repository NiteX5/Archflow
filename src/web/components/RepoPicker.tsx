import { useState } from 'react';
import { api, RequestError } from '../api.js';
import type { AppState } from '../../core/api.js';

/**
 * Browsers cannot reveal absolute folder paths, so the user types the path.
 * The service validates it and only ever accesses that directory.
 */
export function RepoPicker({ onOpened }: { onOpened: (s: AppState) => void }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="center-page">
      <h1>Archflow</h1>
      <p>Choose the repository to open. Archflow will only access this directory.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onOpened(await api.openRepo(path.trim()));
          } catch (err) {
            setError(err instanceof RequestError ? err.message : 'Could not reach the Archflow service.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="Repository path"
          placeholder="/path/to/repository"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={busy || !path.trim()}>
          Open
        </button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
