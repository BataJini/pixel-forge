/**
 * src/ui/shell/fuzzy.ts — a small, dependency-free fuzzy matcher for the command
 * palette (master-spec §3.7 "fuzzy-search every command"). Pure and DOM-free so
 * it is unit-testable in isolation.
 *
 * Scoring: the query is split on whitespace into terms; EVERY term must appear as
 * a case-insensitive subsequence of the target (AND semantics). Each term is
 * scored with a dynamic program that finds the highest-scoring alignment,
 * rewarding matches at word boundaries (string start / after a separator /
 * camelCase humps) and consecutive runs, and penalising gaps. Total score = sum
 * of term scores; matched character indices are returned for highlighting.
 */

const SEPARATORS = new Set([' ', '-', '_', '/', '.', ':', '(', ')', '·', ',']);

const SCORE = {
  match: 16,
  boundary: 14,
  consecutive: 12,
  gap: -1,
  leadingGapPerChar: -1,
  maxLeadingPenalty: -10,
} as const;

const NEG_INF = Number.NEGATIVE_INFINITY;

export interface FuzzyResult {
  readonly matched: boolean;
  readonly score: number;
  /** Matched indices into the ORIGINAL target string, ascending, de-duplicated. */
  readonly indices: readonly number[];
}

const NO_MATCH: FuzzyResult = { matched: false, score: 0, indices: [] };

function isBoundary(target: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const prev = target[index - 1];
  if (SEPARATORS.has(prev)) {
    return true;
  }
  const cur = target[index];
  // camelCase / PascalCase hump: an upper-case char preceded by a lower-case one.
  return cur >= 'A' && cur <= 'Z' && prev >= 'a' && prev <= 'z';
}

/**
 * Best-alignment score of `term` (already lower-cased) as a subsequence of
 * `lowerTarget`, using the original `target` for boundary detection. Returns the
 * score plus chosen indices, or null when `term` is not a subsequence.
 *
 * DP: `dp[qi][ti]` = best score matching `term[0..qi]` with `term[qi]` placed at
 * target position `ti`.
 */
function scoreTerm(
  term: string,
  target: string,
  lowerTarget: string,
): { score: number; indices: number[] } | null {
  const q = term.length;
  const n = target.length;
  if (q === 0) {
    return { score: 0, indices: [] };
  }
  if (q > n) {
    return null;
  }

  const dp: number[][] = Array.from({ length: q }, () => new Array<number>(n).fill(NEG_INF));
  const parent: number[][] = Array.from({ length: q }, () => new Array<number>(n).fill(-1));

  for (let ti = 0; ti < n; ti++) {
    if (lowerTarget[ti] !== term[0]) {
      continue;
    }
    const lead = Math.max(SCORE.leadingGapPerChar * ti, SCORE.maxLeadingPenalty);
    dp[0][ti] = SCORE.match + (isBoundary(target, ti) ? SCORE.boundary : 0) + lead;
  }

  for (let qi = 1; qi < q; qi++) {
    for (let ti = qi; ti < n; ti++) {
      if (lowerTarget[ti] !== term[qi]) {
        continue;
      }
      const cellBase = SCORE.match + (isBoundary(target, ti) ? SCORE.boundary : 0);
      let best = NEG_INF;
      let bestPrev = -1;
      for (let tj = qi - 1; tj < ti; tj++) {
        const prev = dp[qi - 1][tj];
        if (prev === NEG_INF) {
          continue;
        }
        const transition = tj === ti - 1 ? SCORE.consecutive : SCORE.gap * (ti - tj - 1);
        const candidate = prev + transition;
        if (candidate > best) {
          best = candidate;
          bestPrev = tj;
        }
      }
      if (best !== NEG_INF) {
        dp[qi][ti] = cellBase + best;
        parent[qi][ti] = bestPrev;
      }
    }
  }

  let endTi = -1;
  let endScore = NEG_INF;
  for (let ti = q - 1; ti < n; ti++) {
    if (dp[q - 1][ti] > endScore) {
      endScore = dp[q - 1][ti];
      endTi = ti;
    }
  }
  if (endTi < 0) {
    return null;
  }

  const indices: number[] = [];
  let ti = endTi;
  for (let qi = q - 1; qi >= 0; qi--) {
    indices.push(ti);
    ti = parent[qi][ti];
  }
  indices.reverse();
  return { score: endScore, indices };
}

/**
 * Match `query` against `target`. An empty (or whitespace-only) query matches
 * everything with a neutral score of 0. Every whitespace-delimited query term
 * must be a subsequence of the target for a match.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) {
    return { matched: true, score: 0, indices: [] };
  }
  const lowerTarget = target.toLowerCase();
  let total = 0;
  const indices = new Set<number>();
  for (const term of terms) {
    const res = scoreTerm(term, target, lowerTarget);
    if (!res) {
      return NO_MATCH;
    }
    total += res.score;
    for (const i of res.indices) {
      indices.add(i);
    }
  }
  // Prefer shorter targets on ties (a query is "more of" a short label).
  total -= target.length * 0.1;
  return { matched: true, score: total, indices: [...indices].sort((a, b) => a - b) };
}

export interface RankedItem<T> {
  readonly item: T;
  readonly result: FuzzyResult;
}

/**
 * Filter + rank `items` by how well `getText(item)` fuzzy-matches `query`. With an
 * empty query the original order is preserved (stable). Otherwise results are
 * sorted by descending score, then original index for a stable tie-break.
 */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
): RankedItem<T>[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return items.map((item) => ({ item, result: { matched: true, score: 0, indices: [] } }));
  }
  const scored: { entry: RankedItem<T>; order: number }[] = [];
  items.forEach((item, order) => {
    const result = fuzzyMatch(trimmed, getText(item));
    if (result.matched) {
      scored.push({ entry: { item, result }, order });
    }
  });
  scored.sort((a, b) => b.entry.result.score - a.entry.result.score || a.order - b.order);
  return scored.map((s) => s.entry);
}
