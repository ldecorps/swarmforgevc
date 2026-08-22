/**
 * BL-1015 — counting changed lines between a file's current and proposed
 * content, the way `git diff --numstat` counts them. Split out of
 * `measure.ts` (BL-485 mutation-site size): this is a general-purpose LCS
 * line diff with no knowledge of the envelope it feeds.
 */

/**
 * Above this many diff cells the LCS is skipped and an upper bound returned
 * instead. Reached only after common prefix and suffix are trimmed, so it
 * takes a genuine whole-file rewrite — which is over the envelope on any
 * measure, so the verdict is the same either way.
 */
const LCS_CELL_CAP = 4_000_000;

function splitLines(text: string): string[] {
  return text.split('\n');
}

function lcsLength(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
    curr.fill(0);
  }
  return prev[b.length];
}

/**
 * Added plus removed lines, the way `git diff --numstat` counts them.
 *
 * Measuring by FILE SIZE instead would refuse every large file on sight, and
 * large files (the CRAP-heavy ones) are exactly what this run exists to clean
 * — that would make the envelope a ban rather than a bound. So common prefix
 * and suffix are trimmed first and only the genuinely differing middle is
 * diffed, which also keeps a small edit inside a 3000-line file cheap.
 */
export function countChangedLines(before: string | null, after: string | null): number {
  if (before === null && after === null) return 0;
  const a = before === null ? [] : splitLines(before);
  const b = after === null ? [] : splitLines(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ra = a.slice(start, endA);
  const rb = b.slice(start, endB);
  if (ra.length === 0) return rb.length;
  if (rb.length === 0) return ra.length;
  if (ra.length * rb.length > LCS_CELL_CAP) return ra.length + rb.length;
  const common = lcsLength(ra, rb);
  return ra.length - common + (rb.length - common);
}
