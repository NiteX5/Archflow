import type { DerivedView } from '../../core/views.js';
import type { Selection } from './Canvas.js';

const COL = 200;
const TOP = 70;
const ROW = 56;

/** Lifeline diagram of a flow: participants as columns, steps as ordered messages. */
export function SequenceView({ derived, selection, onSelect }: { derived: DerivedView; selection: Selection; onSelect: (s: Selection) => void }) {
  const participants = derived.nodes;
  const index = new Map(participants.map((p, i) => [p.id, i]));
  const steps = derived.flow?.steps ?? [];
  const width = Math.max(1, participants.length) * COL;
  const height = TOP + (steps.length + 1) * ROW;
  const cx = (id: string) => (index.get(id) ?? 0) * COL + COL / 2;

  return (
    <div className="sequence">
      <svg width={width} height={height} role="img" aria-label={`Sequence of ${derived.flow?.name ?? 'flow'}`}>
        <defs>
          <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="seq-arrowhead" />
          </marker>
        </defs>
        {participants.map((p) => (
          <g key={p.id} onClick={() => onSelect({ type: 'element', id: p.id })} className="seq-participant">
            <rect
              x={cx(p.id) - 80}
              y={10}
              width={160}
              height={40}
              rx={6}
              className={selection?.type === 'element' && selection.id === p.id ? 'selected' : ''}
            />
            <text x={cx(p.id)} y={35} textAnchor="middle">
              {p.element.name}
            </text>
            <line x1={cx(p.id)} y1={50} x2={cx(p.id)} y2={height - 10} className="seq-lifeline" />
          </g>
        ))}
        {steps.map((s, i) => {
          const y = TOP + (i + 1) * ROW - ROW / 2;
          const from = cx(s.from);
          const to = s.to !== undefined ? cx(s.to) : from;
          const self = s.to === undefined || s.to === s.from;
          return (
            <g key={s.id} className="seq-step">
              <title>{[s.description, s.condition && `Condition: ${s.condition}`, s.result && `Result: ${s.result}`].filter(Boolean).join('\n')}</title>
              {self ? (
                <path d={`M${from},${y} h40 v16 h-38`} markerEnd="url(#seq-arrow)" fill="none" />
              ) : (
                <line x1={from} y1={y} x2={to} y2={y} markerEnd="url(#seq-arrow)" />
              )}
              <text x={self ? from + 46 : (from + to) / 2} y={y - 6} textAnchor={self ? 'start' : 'middle'}>
                {`${i + 1}. ${s.action}`}
                {s.condition ? ` [${s.condition}]` : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
