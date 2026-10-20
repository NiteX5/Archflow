import type { ReactNode } from 'react';
import { isDeleted, type Model } from '../../core/model.js';
import { categoryOf, type Provenance } from '../../core/schema.js';
import { viewsContaining } from '../../core/views.js';
import type { Selection } from './Canvas.js';
import { provenanceBadge } from './provenance.js';

function Field({ label, children, missing = 'Not documented' }: { label: string; children?: ReactNode; missing?: string }) {
  const empty = children === undefined || children === null || children === false || children === '' || (Array.isArray(children) && children.length === 0);
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={empty ? 'field-value missing' : 'field-value'}>{empty ? missing : children}</div>
    </div>
  );
}

function ProvenanceField({ p }: { p: Provenance | undefined }) {
  const badge = provenanceBadge(p);
  return (
    <Field label="Provenance">
      <span className={`badge badge-${badge.key}`}>{badge.short}</span> {badge.title}
      {p?.verifiedAt && <div>Verified at {p.verifiedAt}</div>}
      {p?.verifiedRevision && <div>Revision {p.verifiedRevision}</div>}
      <div className="evidence">
        {p?.evidence?.length ? (
          <ul>
            {p.evidence.map((e, i) => (
              <li key={i}>
                {e.description}
                {e.ref && <code> {e.ref}</code>}
              </li>
            ))}
          </ul>
        ) : (
          <span className="missing">No evidence recorded</span>
        )}
      </div>
    </Field>
  );
}

export interface DetailPanelProps {
  model: Model;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onOpenView: (viewId: string) => void;
  currentViewHas: boolean;
  /** Editing controls rendered by the editor, if editing is enabled. */
  actions?: ReactNode;
}

export function DetailPanel({ model, selection, onSelect, onOpenView, currentViewHas, actions }: DetailPanelProps) {
  if (!selection) {
    return (
      <aside className="detail">
        <p className="muted">Select an element or relation to see its details.</p>
      </aside>
    );
  }
  const source = model.sources[selection.id];

  if (selection.type === 'relation') {
    const r = model.relations.find((x) => x.id === selection.id);
    if (!r) return <aside className="detail"><p className="muted">Relation "{selection.id}" no longer exists.</p></aside>;
    const name = (id: string) => model.elements.find((e) => e.id === id)?.name ?? id;
    return (
      <aside className="detail">
        <h2>{r.type}</h2>
        <div className="id-line"><code>{r.id}</code> · relation</div>
        {isDeleted(r) && <div className="warning-box">Deleted{r.deletedAt ? ` on ${r.deletedAt}` : ''}{r.deletedReason ? `: ${r.deletedReason}` : ''}</div>}
        {actions}
        <Field label="From"><a onClick={() => onSelect({ type: 'element', id: r.from })}>{name(r.from)}</a></Field>
        <Field label="To"><a onClick={() => onSelect({ type: 'element', id: r.to })}>{name(r.to)}</a></Field>
        <Field label="Description">{r.description}</Field>
        <ProvenanceField p={r.provenance} />
        <Field label="Notes">{r.notes?.map((n, i) => <p key={i}>{n.text}{n.author && <span className="muted"> — {n.author}{n.date ? `, ${n.date}` : ''}</span>}</p>)}</Field>
        <Field label="Defined in"><code>{source?.file}</code></Field>
      </aside>
    );
  }

  const el = model.elements.find((e) => e.id === selection.id);
  if (!el) return <aside className="detail"><p className="muted">Element "{selection.id}" no longer exists.</p></aside>;
  const outgoing = model.relations.filter((r) => r.from === el.id);
  const incoming = model.relations.filter((r) => r.to === el.id);
  const name = (id: string) => model.elements.find((e) => e.id === id)?.name ?? id;
  const children = model.elements.filter((e) => e.parent === el.id);
  const flows = model.flows.filter((f) => f.participants.includes(el.id));
  const decisions = model.decisions.filter((d) => d.relatedTo?.includes(el.id));
  const views = viewsContaining(model, el.id);
  const relLink = (id: string, label: string, deleted: boolean) => (
    <a className={deleted ? 'deleted-text' : ''} onClick={() => onSelect({ type: 'relation', id })}>{label}</a>
  );

  return (
    <aside className="detail">
      <h2>{el.name}</h2>
      <div className="id-line">
        <code>{el.id}</code> · {el.kind} · {categoryOf(el.kind)}
      </div>
      {isDeleted(el) && <div className="warning-box">Deleted{el.deletedAt ? ` on ${el.deletedAt}` : ''}{el.deletedReason ? `: ${el.deletedReason}` : ''}</div>}
      {el.lifecycle === 'deprecated' && <div className="warning-box">Deprecated</div>}
      {!currentViewHas && <div className="info-box">Not shown in the current view.</div>}
      {actions}
      <Field label="Description">{el.description}</Field>
      <Field label="Responsibility">{el.responsibility}</Field>
      <Field label="Parent">{el.parent && <a onClick={() => onSelect({ type: 'element', id: el.parent! })}>{name(el.parent)}</a>}</Field>
      <Field label="Contains" missing="Nothing">
        {children.length > 0 && <ul>{children.map((c) => <li key={c.id}><a onClick={() => onSelect({ type: 'element', id: c.id })}>{c.name}</a></li>)}</ul>}
      </Field>
      <Field label="Outgoing relations" missing="None declared">
        {outgoing.length > 0 && <ul>{outgoing.map((r) => <li key={r.id}>{relLink(r.id, `${r.type} → ${name(r.to)}`, isDeleted(r))}</li>)}</ul>}
      </Field>
      <Field label="Incoming relations" missing="None declared">
        {incoming.length > 0 && <ul>{incoming.map((r) => <li key={r.id}>{relLink(r.id, `${name(r.from)} → ${r.type}`, isDeleted(r))}</li>)}</ul>}
      </Field>
      <Field label="Flows" missing="Not part of any declared flow">
        {flows.length > 0 && <ul>{flows.map((f) => <li key={f.id}>{f.name} <span className="muted">({f.kind})</span></li>)}</ul>}
      </Field>
      <Field label="Business rules">{el.rules?.length ? <ul>{el.rules.map((r, i) => <li key={i}>{r}</li>)}</ul> : undefined}</Field>
      <Field label="Decisions" missing="None linked">
        {decisions.length > 0 && <ul>{decisions.map((d) => <li key={d.id}>{d.title} <span className="muted">({d.status})</span></li>)}</ul>}
      </Field>
      <Field label="Notes">
        {el.notes?.length ? el.notes.map((n, i) => <p key={i}>{n.text}{n.author && <span className="muted"> — {n.author}{n.date ? `, ${n.date}` : ''}</span>}</p>) : undefined}
      </Field>
      <Field label="Source code" missing="No code reference">
        {el.code?.length ? <ul>{el.code.map((c, i) => <li key={i}><code>{c.path}{c.line ? `:${c.line}` : ''}</code>{c.symbol && <> · <code>{c.symbol}</code></>}</li>)}</ul> : undefined}
      </Field>
      <ProvenanceField p={el.provenance} />
      <Field label="Tags" missing="None">{el.tags?.join(', ')}</Field>
      <Field label="Appears in views" missing="No view">
        {views.length > 0 && <ul>{views.map((v) => <li key={v.id}><a onClick={() => onOpenView(v.id)}>{v.name}</a></li>)}</ul>}
      </Field>
      <Field label="Defined in"><code>{source?.file}</code></Field>
    </aside>
  );
}
