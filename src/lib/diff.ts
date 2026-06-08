import DiffMatchPatch from 'diff-match-patch';

export type DiffPart = {
  op: -1 | 0 | 1;
  text: string;
};

const dmp = new DiffMatchPatch();

export function diffTexts(left: string, right: string): DiffPart[] {
  const diffs = dmp.diff_main(left, right);
  dmp.diff_cleanupSemantic(diffs);
  return diffs
    .map(([op, text]) => ({ op: op as -1 | 0 | 1, text }))
    .filter((part) => part.text.length > 0);
}

export function hasTextChange(left: string, right: string): boolean {
  return left.replace(/\s+/g, '') !== right.replace(/\s+/g, '');
}
