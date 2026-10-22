export type Severity = 'error' | 'warning';

export type IssueCode =
  | 'yaml-syntax'
  | 'empty-file'
  | 'ignored-file'
  | 'missing-manifest'
  | 'unsupported-schema-version'
  | 'schema'
  | 'duplicate-id'
  | 'broken-reference'
  | 'invalid-reference-target'
  | 'parent-cycle'
  | 'deleted-reference'
  | 'lifecycle'
  | 'possible-duplicate'
  | 'missing-evidence'
  | 'view-config'
  | 'migration-required'
  | 'relation-config'
  | 'flow-config'
  | 'limit-exceeded'
  | 'unreadable-file';

/** A validation finding, located as precisely as the input allows. */
export interface Issue {
  severity: Severity;
  code: IssueCode;
  /** Path relative to the model directory, POSIX separators. */
  file?: string;
  /** Field path inside the file, e.g. `elements[2].parent`. */
  path?: string;
  line?: number;
  column?: number;
  message: string;
  /** How to fix it. */
  hint?: string;
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out ? `.${String(segment)}` : String(segment);
  }
  return out;
}

export function formatIssue(issue: Issue): string {
  const where = [issue.file ?? '(model)', issue.line !== undefined ? `${issue.line}:${issue.column ?? 1}` : undefined]
    .filter(Boolean)
    .join(':');
  const field = issue.path ? ` ${issue.path}` : '';
  const hint = issue.hint ? `\n    hint: ${issue.hint}` : '';
  return `${issue.severity.toUpperCase()} ${where}${field}: ${issue.message} [${issue.code}]${hint}`;
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
