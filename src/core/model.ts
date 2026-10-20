import type { Decision, Element, Flow, Manifest, Overview, Relation, View } from './schema.js';

export type EntityType = 'element' | 'relation' | 'flow' | 'decision' | 'view';

/** Where an entity is defined; used to locate errors and, later, to persist edits. */
export interface EntitySource {
  type: EntityType;
  file: string;
  /** Field path of the entity inside its file, e.g. `['elements', 3]`. */
  path: (string | number)[];
}

/** A fully validated model. Only produced when validation found no errors. */
export interface Model {
  schemaVersion: number;
  manifest: Manifest;
  overview?: Overview;
  elements: Element[];
  relations: Relation[];
  flows: Flow[];
  decisions: Decision[];
  views: View[];
  /** Entity ID → definition location. IDs are unique across all entity types. */
  sources: Record<string, EntitySource>;
}

export function isDeleted(entity: { lifecycle?: string | undefined }): boolean {
  return entity.lifecycle === 'deleted';
}
