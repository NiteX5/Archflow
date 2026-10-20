import type { Provenance } from '../../core/schema.js';

export type BadgeKey = 'verified' | 'inferred' | 'pending' | 'unknown';

/** Visual label for provenance. Missing provenance is shown as unknown, never as verified. */
export function provenanceBadge(p: Provenance | undefined): { key: BadgeKey; short: string; title: string } {
  if (!p) return { key: 'unknown', short: '?', title: 'Provenance unknown: not documented' };
  switch (p.status) {
    case 'verified':
      return { key: 'verified', short: '✓', title: `Verified (${p.source})` };
    case 'inferred':
      return { key: 'inferred', short: '≈', title: `Inferred (${p.source}): not confirmed` };
    case 'pending-review':
      return { key: 'pending', short: '!', title: `Pending review (${p.source})` };
  }
}
