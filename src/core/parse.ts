import { LineCounter, parseDocument, type Document } from 'yaml';
import type { Issue } from './issues.js';

/** A model file as read from disk, path relative to the model directory. */
export interface ModelFile {
  path: string;
  content: string;
}

export interface ParsedFile {
  path: string;
  data: unknown;
  /** Resolves a field path to a 1-based line/column, falling back to the closest ancestor. */
  locate(path: readonly PropertyKey[]): { line: number; column: number } | undefined;
}

export interface ParseResult {
  parsed?: ParsedFile;
  issues: Issue[];
}

/**
 * Parses YAML with the safe core schema: no custom tags, no code execution,
 * bounded alias expansion (yaml's default `maxAliasCount`).
 */
export function parseModelFile(file: ModelFile): ParseResult {
  const lineCounter = new LineCounter();
  const doc: Document = parseDocument(file.content, { lineCounter, schema: 'core', uniqueKeys: true, prettyErrors: false });
  const issues: Issue[] = [];

  for (const err of doc.errors) {
    const pos = lineCounter.linePos(err.pos[0]);
    issues.push({
      severity: 'error',
      code: 'yaml-syntax',
      file: file.path,
      line: pos.line,
      column: pos.col,
      message: firstLine(err.message),
      hint: 'Fix the YAML syntax; the file is ignored until it parses.',
    });
  }
  if (issues.length > 0) return { issues };

  let data: unknown;
  try {
    data = doc.toJS();
  } catch (err) {
    // e.g. excessive alias expansion.
    return {
      issues: [
        {
          severity: 'error',
          code: 'yaml-syntax',
          file: file.path,
          message: err instanceof Error ? firstLine(err.message) : 'Could not convert YAML document',
        },
      ],
    };
  }

  const locate = (path: readonly PropertyKey[]) => {
    for (let len = path.length; len >= 0; len--) {
      const node = doc.getIn(path.slice(0, len) as unknown[], true) as { range?: [number, number, number] } | undefined;
      if (node && typeof node === 'object' && node.range) {
        const pos = lineCounter.linePos(node.range[0]);
        return { line: pos.line, column: pos.col };
      }
    }
    return undefined;
  };

  return { parsed: { path: file.path, data, locate }, issues };
}

function firstLine(message: string): string {
  return message.split('\n')[0]!.trim();
}
