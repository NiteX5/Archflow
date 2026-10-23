import { useState, type ReactNode } from 'react';
import { usagesOf } from '../../core/hierarchy.js';
import { isDeleted, type Model } from '../../core/model.js';
import { categoryOf, type Provenance, type Relation } from '../../core/schema.js';
import { viewsContaining } from '../../core/views.js';
import { useI18n, type T } from '../i18n.js';
import { iconFor } from './icons.js';
import type { MapSelection } from './MapCanvas.js';
import { provenanceBadge } from './provenance.js';

function Field({ label, children, missing }: { label: string; children?: ReactNode; missing?: string }) {
  const { t } = useI18n();
  const empty = children === undefined || children === null || children === false || children === '' || (Array.isArray(children) && children.length === 0);
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={empty ? 'field-value missing' : 'field-value'}>{empty ? (missing ?? t('Not documented')) : children}</div>
    </div>
  );
}

function Section({ title, children, collapsible }: { title: string; children: ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <section className="panel-section">
      <h3 className={collapsible ? 'clickable' : ''} onClick={collapsible ? () => setOpen(!open) : undefined}>
        {collapsible && <span className="caret">{open ? '▾' : '▸'}</span>}
        {title}
      </h3>
      {open && children}
    </section>
  );
}

function ProvenanceField({ p, t }: { p: Provenance | undefined; t: T }) {
  const badge = provenanceBadge(p);
  return (
    <Field label={t('Provenance')}>
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
          <span className="missing">{t('No evidence recorded')}</span>
        )}
      </div>
    </Field>
  );
}

export interface DetailPanelProps {
  model: Model;
  selection: MapSelection;
  onSelect: (s: MapSelection) => void;
  onOpenView: (viewId: string) => void;
  currentViewHas: boolean;
  /** Editing controls rendered by the editor, if editing is enabled. */
  actions?: ReactNode;
}

export function DetailPanel({ model, selection, onSelect, onOpenView, currentViewHas, actions }: DetailPanelProps) {
  const { t } = useI18n();
  const name = (id: string) => model.elements.find((e) => e.id === id)?.name ?? id;
  const elLink = (id: string) => (
    <a onClick={() => onSelect({ type: 'element', id })}>{name(id)}</a>
  );
  const chips = (ids: readonly string[] | undefined) =>
    ids?.length ? (
      <span className="edge-chips inline">
        {ids.map((id) => (
          <button key={id} className="chip" onClick={() => onSelect({ type: 'element', id })}>
            {name(id)}
          </button>
        ))}
      </span>
    ) : null;
  const relLine = (r: Relation, dir: 'out' | 'in') => (
    <li key={r.id} className={isDeleted(r) ? 'deleted-text' : ''}>
      <a onClick={() => onSelect({ type: 'relation', id: r.id })}>{r.type}</a> {dir === 'out' ? '→' : '←'} {elLink(dir === 'out' ? r.to : r.from)} {chips(r.via)}
    </li>
  );

  if (!selection) {
    return (
      <aside className="detail">
        <p className="muted">{t('Select an element or relation to see its details.')}</p>
      </aside>
    );
  }

  if (selection.type === 'edge') {
    const rels = model.relations.filter((r) => selection.relations.includes(r.id));
    return (
      <aside className="detail">
        <h2>
          {name(selection.from)} → {name(selection.to)}
        </h2>
        <Section title={t('Relations between these elements')}>
          <ul className="plain">
            {rels.map((r) => (
              <li key={r.id}>
                {elLink(r.from)} <a onClick={() => onSelect({ type: 'relation', id: r.id })}>{r.type}</a> {elLink(r.to)} {chips(r.via)}
                {r.description && <div className="muted">{r.description}</div>}
              </li>
            ))}
          </ul>
        </Section>
        {selection.via.length > 0 && (
          <Section title={t('Functional dependencies involved')}>
            {chips(selection.via)}
          </Section>
        )}
      </aside>
    );
  }

  const source = model.sources[selection.id];

  if (selection.type === 'relation') {
    const r = model.relations.find((x) => x.id === selection.id);
    if (!r) return <aside className="detail"><p className="muted">"{selection.id}"?</p></aside>;
    return (
      <aside className="detail">
        <h2>{r.type}</h2>
        <div className="id-line"><code>{r.id}</code></div>
        {isDeleted(r) && <div className="warning-box">{t('Deleted')}{r.deletedAt ? ` · ${r.deletedAt}` : ''}{r.deletedReason ? `: ${r.deletedReason}` : ''}</div>}
        {actions}
        <Section title={t('What it is and what it is for')}>
          <p>{elLink(r.from)} → {elLink(r.to)}</p>
          <Field label={t('Description')}>{r.description}</Field>
          {r.via?.length ? <Field label={t('Passes through')}>{chips(r.via)}</Field> : null}
        </Section>
        <Section title={t('More details')} collapsible>
          <ProvenanceField p={r.provenance} t={t} />
          <Field label={t('Notes')}>{r.notes?.map((n, i) => <p key={i}>{n.text}</p>)}</Field>
          <Field label={t('Defined in')}><code>{source?.file}</code></Field>
        </Section>
      </aside>
    );
  }

  const el = model.elements.find((e) => e.id === selection.id);
  if (!el) return <aside className="detail"><p className="muted">"{selection.id}"?</p></aside>;
  const Icon = iconFor(el.kind);
  const category = categoryOf(el.kind);
  const outgoing = model.relations.filter((r) => r.from === el.id && r.type !== 'uses');
  const incoming = model.relations.filter((r) => r.to === el.id && r.type !== 'uses');
  const uses = model.relations.filter((r) => r.from === el.id && r.type === 'uses');
  const usedBy = category === 'functional' ? usagesOf(model, el.id) : [];
  const children = model.elements.filter((e) => e.parent === el.id && !isDeleted(e));
  const flows = model.flows.filter((f) => f.participants.includes(el.id));
  const decisions = model.decisions.filter((d) => d.relatedTo?.includes(el.id));
  const views = viewsContaining(model, el.id);

  return (
    <aside className="detail">
      <h2 className="detail-title">
        <Icon size={22} aria-hidden="true" className={`cat-icon cat-${category}`} />
        {el.name}
      </h2>
      <div className="id-line">
        <code>{el.id}</code> · {el.kind}
      </div>
      {isDeleted(el) && <div className="warning-box">{t('Deleted')}{el.deletedAt ? ` · ${el.deletedAt}` : ''}{el.deletedReason ? `: ${el.deletedReason}` : ''}</div>}
      {el.lifecycle === 'deprecated' && <div className="warning-box">{t('Deprecated')}</div>}
      {!currentViewHas && <div className="info-box">{t('Not shown in the current view.')}</div>}
      {actions}

      <Section title={t('What it is and what it is for')}>
        {el.summary ? <p className="summary">{el.summary}</p> : <p className="missing">{t('Not documented')}</p>}
        {el.description && <p>{el.description}</p>}
        <Field label={t('Responsibility')}>{el.responsibility}</Field>
        {el.parent && <Field label={t('Part of')}>{elLink(el.parent)}</Field>}
      </Section>

      <Section title={t('Where it is used / what it uses')}>
        {category === 'functional' && (
          <Field label={t('Used by')} missing={t('None declared')}>
            {usedBy.length > 0 && (
              <ul className="plain">
                {usedBy.map((r) => (
                  <li key={r.id}>
                    {r.type === 'uses' ? elLink(r.from) : <>{elLink(r.from)} → {elLink(r.to)}</>} <span className="muted">({r.type})</span>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        )}
        {uses.length > 0 && <Field label={t('Uses')}>{chips(uses.map((r) => r.to))}</Field>}
        <Field label={t('Calls / depends on')} missing={t('None declared')}>
          {outgoing.length > 0 && <ul className="plain">{outgoing.map((r) => relLine(r, 'out'))}</ul>}
        </Field>
        <Field label={t('Called by / depended on by')} missing={t('None declared')}>
          {incoming.length > 0 && <ul className="plain">{incoming.map((r) => relLine(r, 'in'))}</ul>}
        </Field>
        <Field label={t('Contains')} missing={t('Nothing')}>
          {children.length > 0 && <ul className="plain">{children.map((c) => <li key={c.id}>{elLink(c.id)} <span className="muted">{c.kind}</span></li>)}</ul>}
        </Field>
      </Section>

      <Section title={t('How it works')}>
        <Field label={t('Steps')}>
          {el.howItWorks?.length ? <ol>{el.howItWorks.map((s, i) => <li key={i}>{s}</li>)}</ol> : undefined}
        </Field>
        <Field label={t('Business rules')}>{el.rules?.length ? <ul>{el.rules.map((r, i) => <li key={i}>{r}</li>)}</ul> : undefined}</Field>
        <Field label={t('Flows')} missing={t('Not part of any declared flow')}>
          {flows.length > 0 && <ul className="plain">{flows.map((f) => <li key={f.id}>{f.name} <span className="muted">({f.kind})</span></li>)}</ul>}
        </Field>
      </Section>

      <Section title={t('More details')} collapsible>
        <Field label={t('Source code')} missing={t('No code reference')}>
          {el.code?.length ? <ul>{el.code.map((c, i) => <li key={i}><code>{c.path}{c.line ? `:${c.line}` : ''}</code>{c.symbol && <> · <code>{c.symbol}</code></>}</li>)}</ul> : undefined}
        </Field>
        <ProvenanceField p={el.provenance} t={t} />
        <Field label={t('Decisions')} missing={t('None linked')}>
          {decisions.length > 0 && <ul>{decisions.map((d) => <li key={d.id}>{d.title} <span className="muted">({d.status})</span></li>)}</ul>}
        </Field>
        <Field label={t('Notes')}>
          {el.notes?.length ? el.notes.map((n, i) => <p key={i}>{n.text}{n.author && <span className="muted"> — {n.author}{n.date ? `, ${n.date}` : ''}</span>}</p>) : undefined}
        </Field>
        <Field label={t('Tags')} missing={t('None')}>{el.tags?.join(', ')}</Field>
        <Field label={t('Appears in views')} missing={t('No view')}>
          {views.length > 0 && <ul>{views.map((v) => <li key={v.id}><a onClick={() => onOpenView(v.id)}>{v.name}</a></li>)}</ul>}
        </Field>
        <Field label={t('Defined in')}><code>{source?.file}</code></Field>
      </Section>
    </aside>
  );
}
