import { useState } from 'react';
import type { AppState } from '../core/api.js';
import type { Box } from '../core/layout.js';
import type { Op } from '../core/ops.js';
import type { DerivedView } from '../core/views.js';
import { BUILTIN_PREFIX } from '../core/views.js';
import { api, RequestError } from './api.js';
import type { Selection } from './components/Canvas.js';
import { Dialog } from './components/Dialog.js';

export type ExtrasDialog = 'view-settings';

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

export const Extras = {
  Buttons: (_props: { state: AppState; editable: boolean; open: (which: ExtrasDialog) => void }) => null,
  NoModel,
  Dialogs: (props: DialogsProps) => {
    switch (props.which) {
      case 'view-settings':
        return <ViewSettings {...props} />;
    }
  },
};
