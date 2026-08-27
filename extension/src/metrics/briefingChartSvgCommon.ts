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
