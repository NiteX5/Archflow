/**
 * Native Archflow model schema, version 1.
 *
 * This module is isomorphic: it must not import Node APIs so that the browser
 * can reuse it (e.g. to validate an import before sending it to the server).
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;
export const MODEL_DIR = '.archflow';

/** Stable identifier: lowercase slug, independent of names, paths or positions. */
export const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
export const idSchema = z
  .string()
  .max(100, 'IDs must be at most 100 characters')
  .regex(ID_PATTERN, 'IDs must be lowercase slugs such as "api-gateway" or "svc.billing"');

/**
 * Element kinds supported by schema v1, grouped by the semantic category that
 * views use to derive their content (spec §5). The category is derived from the
 * kind; it is never stored, so it cannot drift.
 */
export const ELEMENT_KINDS = {
  infrastructure: [
    'cloud-provider',
    'environment',
    'server',
    'container',
    'network',
    'load-balancer',
    'storage',
    'message-broker',
    'deployment',
    'infrastructure-resource',
  ],
  system: ['system', 'application', 'web-app', 'api', 'service', 'external-system', 'integration', 'domain'],
  internal: ['module', 'package', 'controller', 'component', 'repository', 'interface', 'library'],
  behavior: ['function', 'method', 'business-rule'],
  data: ['database', 'table', 'data-entity', 'schema'],
  business: ['actor', 'use-case', 'process'],
  documentation: ['requirement', 'constraint'],
} as const;

export type ElementCategory = keyof typeof ELEMENT_KINDS;
export type ElementKind = (typeof ELEMENT_KINDS)[ElementCategory][number];

export const ALL_ELEMENT_KINDS = Object.values(ELEMENT_KINDS).flat() as ElementKind[];

export function categoryOf(kind: ElementKind): ElementCategory {
  for (const [category, kinds] of Object.entries(ELEMENT_KINDS)) {
    if ((kinds as readonly string[]).includes(kind)) return category as ElementCategory;
  }
  // Unreachable for validated input; kept explicit instead of returning a default.
  throw new Error(`Unknown element kind: ${kind}`);
}

/** Relation types supported by schema v1 (spec §5.7). New types require a schema bump. */
export const RELATION_TYPES = [
  'depends-on',
  'calls',
  'contains',
  'implements',
  'deploys-to',
  'reads',
  'writes',
  'sends-data-to',
  'receives-data-from',
  'participates-in',
  'integrates-with',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const PROVENANCE_SOURCES = ['manual', 'agent', 'code-observed', 'tool-inferred'] as const;
export const VERIFICATION_STATUSES = ['verified', 'inferred', 'pending-review'] as const;
export const LIFECYCLES = ['active', 'deprecated', 'deleted'] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/, 'Use an ISO 8601 date such as "2026-01-31"');

/** Repository-relative POSIX path: no absolute paths, no "..", no backslashes. */
export const repoPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith('/') && !/^[a-zA-Z]:/.test(p), 'Paths must be relative to the repository root')
  .refine((p) => !p.includes('\\'), 'Use forward slashes in paths')
  .refine((p) => !p.split('/').includes('..'), 'Paths must not contain ".." segments');

const evidenceSchema = z.strictObject({
  description: z.string().min(1),
  /** Repository path or URL supporting the fact. */
  ref: z.string().min(1).optional(),
});

export const provenanceSchema = z.strictObject({
  source: z.enum(PROVENANCE_SOURCES),
  status: z.enum(VERIFICATION_STATUSES),
  evidence: z.array(evidenceSchema).optional(),
  verifiedAt: isoDate.optional(),
  verifiedRevision: z.string().min(1).optional(),
});

const noteSchema = z.strictObject({
  text: z.string().min(1),
  author: z.string().min(1).optional(),
  date: isoDate.optional(),
});

const codeRefSchema = z.strictObject({
  path: repoPathSchema,
  symbol: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
});

/** Free-form metadata, e.g. preserved attributes from an imported diagram. */
const metadataSchema = z.record(z.string(), z.unknown());

const lifecycleFields = {
  lifecycle: z.enum(LIFECYCLES).optional(),
  deletedAt: isoDate.optional(),
  deletedReason: z.string().min(1).optional(),
};

export const elementSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(ALL_ELEMENT_KINDS as [ElementKind, ...ElementKind[]]),
  name: z.string().min(1).max(200),
  description: z.string().min(1).optional(),
  responsibility: z.string().min(1).optional(),
  /** Grouping/containment: ID of the containing element. */
  parent: idSchema.optional(),
  tags: z.array(z.string().min(1)).optional(),
  code: z.array(codeRefSchema).optional(),
  rules: z.array(z.string().min(1)).optional(),
  notes: z.array(noteSchema).optional(),
  provenance: provenanceSchema.optional(),
  metadata: metadataSchema.optional(),
  ...lifecycleFields,
});

export const relationSchema = z.strictObject({
  id: idSchema,
  type: z.enum(RELATION_TYPES),
  from: idSchema,
  to: idSchema,
  description: z.string().min(1).optional(),
  notes: z.array(noteSchema).optional(),
  provenance: provenanceSchema.optional(),
  metadata: metadataSchema.optional(),
  ...lifecycleFields,
});

export const elementsFileSchema = z.strictObject({
  elements: z.array(elementSchema).optional(),
  relations: z.array(relationSchema).optional(),
});

export const manifestSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  project: z.strictObject({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
  }),
});

export const overviewSchema = z.strictObject({
  summary: z.string().min(1),
  context: z.string().min(1).optional(),
  /** Entry points an agent should read first. */
  keyElements: z.array(idSchema).optional(),
  /** Known gaps: information that is unknown or still to be documented. */
  unknowns: z.array(z.string().min(1)).optional(),
});

const flowStepSchema = z.strictObject({
  id: idSchema,
  from: idSchema,
  to: idSchema.optional(),
  action: z.string().min(1),
  description: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  result: z.string().min(1).optional(),
});

export const FLOW_KINDS = ['execution', 'business', 'data', 'event'] as const;

export const flowSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(FLOW_KINDS),
  name: z.string().min(1).max(200),
  description: z.string().min(1).optional(),
  participants: z.array(idSchema).min(1),
  steps: z.array(flowStepSchema).optional(),
  notes: z.array(noteSchema).optional(),
  provenance: provenanceSchema.optional(),
  metadata: metadataSchema.optional(),
  ...lifecycleFields,
});

export const flowFileSchema = z.strictObject({ flow: flowSchema });

export const DECISION_STATUSES = ['proposed', 'accepted', 'superseded', 'deprecated'] as const;

export const decisionSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  status: z.enum(DECISION_STATUSES),
  date: isoDate.optional(),
  context: z.string().min(1).optional(),
  decision: z.string().min(1).optional(),
  consequences: z.string().min(1).optional(),
  /** IDs of elements, relations or flows the decision applies to. */
  relatedTo: z.array(idSchema).optional(),
  supersededBy: idSchema.optional(),
  provenance: provenanceSchema.optional(),
  ...lifecycleFields,
});

export const decisionsFileSchema = z.strictObject({ decisions: z.array(decisionSchema) });

export const VIEW_TYPES = ['overview', 'dependencies', 'sequence', 'deployment', 'data', 'business', 'free'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const SHAPES = ['rectangle', 'rounded', 'ellipse', 'cylinder', 'hexagon', 'document'] as const;

/** Icons available for elements in views (rendered by the UI). */
export const ICONS = [
  'server',
  'database',
  'user',
  'users',
  'cloud',
  'queue',
  'lock',
  'key',
  'shield',
  'globe',
  'mobile',
  'gear',
  'document',
  'cache',
  'mail',
  'api',
  'webhook',
  'network',
  'container',
  'storage',
  'code',
  'package',
  'workflow',
  'table',
  'chart',
  'cpu',
  'layers',
  'rocket',
] as const;

const layoutEntrySchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

const styleEntrySchema = z.strictObject({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color such as "#1f6feb"').optional(),
  shape: z.enum(SHAPES).optional(),
  icon: z.enum(ICONS).optional(),
});

/**
 * A view stores presentation only. Membership of derived views comes from the
 * model; `include`/`exclude` let the user adjust it, and a `free` view is built
 * from `include` alone.
 */
export const viewSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(200),
  type: z.enum(VIEW_TYPES),
  description: z.string().min(1).optional(),
  /** Flow shown by sequence/business views. */
  flow: idSchema.optional(),
  include: z.array(idSchema).optional(),
  exclude: z.array(idSchema).optional(),
  layout: z.record(idSchema, layoutEntrySchema).optional(),
  styles: z.record(idSchema, styleEntrySchema).optional(),
  /** Free-form, e.g. what could not be converted when the view was imported. */
  metadata: metadataSchema.optional(),
});

export const viewFileSchema = z.strictObject({ view: viewSchema });

export type Provenance = z.infer<typeof provenanceSchema>;
export type Element = z.infer<typeof elementSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type Flow = z.infer<typeof flowSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type View = z.infer<typeof viewSchema>;
