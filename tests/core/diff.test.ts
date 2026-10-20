import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/core/diff.js';

describe('diffLines', () => {
  it('marks added, removed and unchanged lines', () => {
    expect(diffLines('a\nb\nc\n', 'a\nx\nc\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });
  it('handles created and removed files', () => {
    expect(diffLines('', 'a')).toEqual([{ kind: 'add', text: 'a' }]);
    expect(diffLines('a', '')).toEqual([{ kind: 'del', text: 'a' }]);
  });
  it('falls back for very large inputs', () => {
    expect(diffLines('a\nb', 'b\na', 1)).toHaveLength(4);
  });
});
