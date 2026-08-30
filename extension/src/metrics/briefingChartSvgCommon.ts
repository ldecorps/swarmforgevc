// Shared SVG helpers for briefing email charts (BL-896 burndown, BL-1184 shift velocity).

export function escapeXmlForSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Nice upper bound for a linear Y axis; `zeroFloor` when the series max is ≤ 0. */
export function niceChartAxisMax(value: number, zeroFloor: number): number {
  if (value <= 0) {
    return zeroFloor;
  }
  const padded = value * 1.1;
  const mag = Math.pow(10, Math.floor(Math.log10(padded)));
  const norm = padded / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * BL-1232: the minimum horizontal distance between two rendered date labels.
 *
 * Derived, not chosen: a `YYYY-MM-DD` label is 10 characters at font-size 11 in
 * the monospace stack these charts use, whose advance width is ~0.6em, so the
 * label itself is ~66px wide. 72px is that plus a small gutter, which is what
 * makes two adjacent labels legible rather than merely non-overlapping. A
 * smaller number would be a magic one.
 */
export const MIN_DATE_LABEL_GAP_PX = 72;

/**
 * Which points may carry an x-axis label, given where they actually plot.
 *
 * The chart that shipped picked indices - first, middle, last - which says
 * nothing about pixels. Under a warped time axis the first two of those can
 * land a few pixels apart and their labels stack into an unreadable smear;
 * that is BL-1232's failure 2, and picking by INDEX is why no amount of
 * relabelling fixes it.
 *
 * The most recent point always keeps its label: a reader's first question of a
 * trend chart is "as of when?". From there the walk is right to left, greedily
 * accepting a candidate that clears `minGapPx` from the last label kept, so the
 * labels that survive are the recent ones - which is the same end of the series
 * the warp gives room to.
 *
 * Returns ascending indices, so a caller renders them in series order.
 */
export function pickLabelIndicesByPixelGap(xs: readonly number[], minGapPx: number): number[] {
  if (xs.length === 0) {
    return [];
  }
  const kept: number[] = [xs.length - 1];
  for (let i = xs.length - 2; i >= 0; i -= 1) {
    if (Math.abs(xs[kept[kept.length - 1]] - xs[i]) >= minGapPx) {
      kept.push(i);
    }
  }
  return kept.sort((a, b) => a - b);
}
