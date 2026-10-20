/**
 * Edit operations sent by the UI. They are applied to the canonical YAML files
 * by the service; there is no separate visual copy of the model.
 *
 * Every operation that changes an existing entity may carry `expected`: the
 * hash ({@link hashValue}) of the entity as the client last saw it. If the
 * entity changed since (e.g. Claude edited the file), the whole request is
 * rejected as a conflict instead of overwriting the other change.
 */
import { z } from 'zod';
import type { AppState } from './api.js';
import { hashValue } from './hash.js';
import type { Model } from './model.js';
import { idSchema } from './schema.js';

export const ENTITY_TYPES = ['element', 'relation', 'flow', 'decision', 'view'] as const;

const layoutEntry = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

const record = z.record(z.string(), z.unknown());

export const opSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('create'),
    entity: z.enum(ENTITY_TYPES),
    value: record,
    /** Target file relative to the model directory; a default is chosen when omitted. */
    file: z.string().optional(),
  }),
  z.strictObject({
    op: z.literal('update'),
    /** Entity ID, or a built-in view ID (then a view file is created first). */
    id: z.string().min(1),
    /** Fields to set; `null` removes a field. `id` cannot be changed. */
    set: record,
    expected: z.string().optional(),
  }),
  z.strictObject({ op: z.literal('delete'), id: idSchema, reason: z.string().min(1).optional(), expected: z.string().optional() }),
  z.strictObject({ op: z.literal('restore'), id: idSchema, expected: z.string().optional() }),
  z.strictObject({
    op: z.literal('layout'),
    /** View ID, or a built-in view ID (then a view file is created). */
    view: z.string().min(1),
    entries: z.record(idSchema, layoutEntry.nullable()),
    /** Element ID → hash of its layout entry as last seen (`hashValue(null)` when absent). */
    expected: z.record(idSchema, z.string()).optional(),
  }),
  z.strictObject({
    op: z.literal('style'),
    view: z.string().min(1),
    element: idSchema,
    style: record.nullable(),
    expected: z.string().optional(),
  }),
]);

export const opsRequestSchema = z.strictObject({ ops: z.array(opSchema).min(1).max(500) });

export type Op = z.infer<typeof opSchema>;
export type OpsRequest = z.infer<typeof opsRequestSchema>;

export interface Conflict {
  id: string;
  message: string;
  /** Current value on disk, so the user can compare. */
  current?: unknown;
}

export interface OpsResult {
  state: AppState;
  /** Built-in view ID → ID of the view file created for it. */
  createdViews: Record<string, string>;
}

/** Hash of an entity as stored in the model (what `expected` must contain). */
export function entityHash(model: Model, id: string): string | undefined {
  const entity =
    model.elements.find((e) => e.id === id) ??
    model.relations.find((r) => r.id === id) ??
    model.flows.find((f) => f.id === id) ??
    model.decisions.find((d) => d.id === id) ??
    model.views.find((v) => v.id === id);
  return entity ? hashValue(entity) : undefined;
}

/** Suggests a stable ID: a readable slug plus a random suffix, so it is not derived only from the name. */
export function suggestId(name: string, taken: (id: string) => boolean, random: () => number = Math.random): string {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'item';
  for (;;) {
    const suffix = Math.floor(random() * 36 ** 4)
      .toString(36)
      .padStart(4, '0');
    const id = `${slug}-${suffix}`;
    if (!taken(id)) return id;
  }
}
