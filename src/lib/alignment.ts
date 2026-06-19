import type { AlignRow, Article } from '../types';

const DEFAULT_GAP_PENALTY = 0.4;
const DEFAULT_MIN_MATCH = 0.4;
const DEFAULT_SAME_NUMBER_MIN_MATCH = 0.18;
const DEFAULT_MOVE_RESCUE = 0.55;

export function articleSimilarity(left: Article, right: Article): number {
  const a = normalizeForCompare(left.text);
  const b = normalizeForCompare(right.text);
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const editScore = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const bigramScore = jaccardBigrams(a, b);
  return Math.max(0, Math.min(1, Math.max(editScore, bigramScore)));
}

export function alignArticles(
  left: Article[],
  right: Article[],
  options: { gapPenalty?: number; minMatchSimilarity?: number; moveRescueSimilarity?: number } = {}
): AlignRow[] {
  const gapPenalty = options.gapPenalty ?? DEFAULT_GAP_PENALTY;
  const minMatchSimilarity = options.minMatchSimilarity ?? DEFAULT_MIN_MATCH;
  const moveRescueSimilarity = options.moveRescueSimilarity ?? DEFAULT_MOVE_RESCUE;
  const m = left.length;
  const n = right.length;
  const dp = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  const back = Array.from({ length: m + 1 }, () => Array<'match' | 'delete' | 'insert' | null>(n + 1).fill(null));

  for (let i = 1; i <= m; i += 1) {
    dp[i][0] = dp[i - 1][0] - gapPenalty;
    back[i][0] = 'delete';
  }
  for (let j = 1; j <= n; j += 1) {
    dp[0][j] = dp[0][j - 1] - gapPenalty;
    back[0][j] = 'insert';
  }

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const sim = articleSimilarity(left[i - 1], right[j - 1]);
      const match = dp[i - 1][j - 1] + sim;
      const del = dp[i - 1][j] - gapPenalty;
      const ins = dp[i][j - 1] - gapPenalty;
      const best = Math.max(match, del, ins);
      dp[i][j] = best;
      back[i][j] = best === match ? 'match' : best === del ? 'delete' : 'insert';
    }
  }

  const rows: AlignRow[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const step = back[i][j];
    if (step === 'match') {
      const similarity = articleSimilarity(left[i - 1], right[j - 1]);
      if (similarity < minMatchSimilarity) {
        rows.push({ left: null, right: right[j - 1], type: 'inserted', similarity: 0 });
        rows.push({ left: left[i - 1], right: null, type: 'deleted', similarity: 0 });
      } else {
        rows.push({ left: left[i - 1], right: right[j - 1], type: 'matched', similarity });
      }
      i -= 1;
      j -= 1;
    } else if (step === 'delete') {
      rows.push({ left: left[i - 1], right: null, type: 'deleted', similarity: 0 });
      i -= 1;
    } else {
      rows.push({ left: null, right: right[j - 1], type: 'inserted', similarity: 0 });
      j -= 1;
    }
  }

  return rescueMovedPairs(rows.reverse(), moveRescueSimilarity);
}

function rescueMovedPairs(rows: AlignRow[], threshold: number): AlignRow[] {
  const deleted = rows
    .map((row, index) => ({ row, index }))
    .filter((item): item is { row: AlignRow & { left: Article; right: null }; index: number } => item.row.type === 'deleted' && !!item.row.left);
  const inserted = rows
    .map((row, index) => ({ row, index }))
    .filter((item): item is { row: AlignRow & { left: null; right: Article }; index: number } => item.row.type === 'inserted' && !!item.row.right);

  const candidates = deleted
    .flatMap((leftItem) =>
      inserted.map((rightItem) => ({
        leftIndex: leftItem.index,
        rightIndex: rightItem.index,
        left: leftItem.row.left,
        right: rightItem.row.right,
        similarity: articleSimilarity(leftItem.row.left, rightItem.row.right)
      }))
    )
    .filter(
      (candidate) =>
        candidate.similarity >= threshold ||
        (sameArticleNumber(candidate.left, candidate.right) && candidate.similarity >= DEFAULT_SAME_NUMBER_MIN_MATCH)
    )
    .sort((a, b) => b.similarity - a.similarity);

  const usedDeleted = new Set<number>();
  const usedInserted = new Set<number>();
  const matches = new Map<number, AlignRow>();
  for (const candidate of candidates) {
    if (usedDeleted.has(candidate.leftIndex) || usedInserted.has(candidate.rightIndex)) continue;
    usedDeleted.add(candidate.leftIndex);
    usedInserted.add(candidate.rightIndex);
    matches.set(candidate.leftIndex, {
      left: candidate.left,
      right: candidate.right,
      type: 'matched',
      similarity: candidate.similarity,
      moved: true
    });
  }

  return rows.flatMap((row, index) => {
    const rescued = matches.get(index);
    if (rescued) return [rescued];
    if (usedInserted.has(index)) return [];
    return [row];
  });
}

function sameArticleNumber(left: Article, right: Article): boolean {
  return Boolean(left.number && right.number && left.number.trim() === right.number.trim());
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, '').replace(/[，。！？；：、“”‘’（）()《》]/g, '');
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function jaccardBigrams(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function bigrams(text: string): Set<string> {
  if (text.length <= 1) return new Set(text ? [text] : []);
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}
