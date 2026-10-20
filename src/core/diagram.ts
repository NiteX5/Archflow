/** Neutral result of parsing an external diagram (Mermaid, draw.io) before it becomes model entities. */
import type { ElementKind } from './schema.js';

export interface ImportedNode {
  /** ID in the source diagram. */
  sourceId: string;
  label: string;
  /** Kind suggested by the source shape (e.g. a cylinder is a database); absent when unknown. */
  kindHint?: ElementKind;
  shape?: string;
  /** Source ID of the containing node (subgraph, container). */
  parent?: string;
  box?: { x: number; y: number; width: number; height: number };
}

export interface ImportedEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface ImportedSequence {
  participants: { sourceId: string; label: string; actor: boolean }[];
  steps: { from: string; to: string; label: string; condition?: string }[];
}

export interface DiagramImport {
  kind: 'graph' | 'sequence';
  title?: string;
  nodes: ImportedNode[];
  edges: ImportedEdge[];
  sequence?: ImportedSequence;
  /** Human-readable notes about what was approximated or skipped. */
  warnings: string[];
  /** Source fragments that could not be converted (kept as metadata). */
  unconverted: string[];
}

export class DiagramParseError extends Error {}
