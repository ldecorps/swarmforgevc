/**
 * BL-604: the morning briefing's TREND ANALYSIS section.
 *
 * "Analysis, not charts" is the load-bearing phrase in the ticket: this reads
 * the same nine behaviour-trend series the board plots and says what CHANGED
 * and whether it matters, in words, ranked so the briefing leads with the
 * trend that moved most.
 *
 * PURE - series in, ranked bullets out. Every impure edge (loading a series,
 * printing the section, shelling from handoffd) lives outside this module, the
 * same split every other briefing section uses.
 *
 * The narrative may not disagree with the chart beside it. Direction and
 * magnitude are `computeTrend`'s own, for the same series, and nothing here
 * recomputes, smooths, or re-thresholds them - a second judgement is exactly
 * what invariant 1 forbids, because the reader would then see a bullet and a
 * chart that contradict each other with no way to tell which lied.
 */

import { computeTrend, TrendDirection, TrendSeriesPoint } from './trend';
import { loadPointsSafely, TrendsBoardContext, TrendsBoardSeriesSource } from './trendsBoard';
import { TRENDS_BOARD_SERIES } from './trendsBoardRegistry';

/** The briefing is read on a phone: the section stops, it does not scroll. */
export const TREND_ANALYSIS_MAX_BULLETS = 5;

export const TREND_ANALYSIS_HEADING = 'Trend analysis';

export interface TrendAnalysisBullet {
  seriesId: string;
  label: string;
  direction: Exclude<TrendDirection, 'unknown'>;
  /** computeTrend's own delta for this series - never re-derived. */
  delta: number;
  currentValue: number;
  priorValue: number;
  /** How far this trend moved, relative to where it was. Ranks the bullets. */
  significance: number;
  /** The rendered line, direction + magnitude + one line of "so what". */
  text: string;
}

const ARROW: Record<Exclude<TrendDirection, 'unknown'>, string> = {
  up: 'up',
  down: 'down',
  flat: 'flat',
};

/**
 * How much a trend moved, for ranking. Relative to the prior period, because
 * an absolute delta ranks whichever series happens to be measured in the
 * largest units - a token count would outrank every approval-tap collapse
 * forever. A prior of zero has no meaningful ratio, so the absolute delta
 * stands in; that is the one case where the two scales meet.
 */
export function trendSignificance(delta: number, priorValue: number): number {
  if (priorValue === 0) {
    return Math.abs(delta);
  }
  return Math.abs(delta / priorValue);
}

/**
 * The one line of "so what". Deliberately about the SHAPE of the change and
 * never about whether it is good news: this module has no per-series notion of
 * which direction is desirable, and inventing one here would be the second
 * judgement invariant 1 forbids. A caller that wants "up is bad for this
 * series" states it in the series' own label.
 */
export function significanceLine(direction: Exclude<TrendDirection, 'unknown'>, significance: number): string {
  if (direction === 'flat') {
    return 'held steady against the prior period';
  }
  if (significance >= 1) {
    return 'more than doubled against the prior period';
  }
  if (significance >= 0.25) {
    return 'a material move against the prior period';
  }
  return 'a small move against the prior period';
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function bulletText(
  label: string,
  direction: Exclude<TrendDirection, 'unknown'>,
  delta: number,
  currentValue: number,
  priorValue: number,
  significance: number
): string {
  const magnitude = `${delta > 0 ? '+' : ''}${formatValue(delta)}`;
  return (
    `${label}: ${ARROW[direction]} ${magnitude} ` +
    `(${formatValue(priorValue)} → ${formatValue(currentValue)}) — ` +
    significanceLine(direction, significance)
  );
}

/**
 * One series' bullet, or null when it cannot be trended.
 *
 * `unknown` is precisely computeTrend's "fewer than two points" answer, so the
 * omission rule needs no threshold of its own - and a series that is absent,
 * unlanded, or whose loader threw arrives here as an empty array and falls out
 * through the same clause. Absence of data is never rendered as a finding
 * (invariant 2): a series reported as "no change" reads as evidence that
 * nothing happened, when the truth is that nobody looked.
 */
export function analyseSeries(
  id: string,
  label: string,
  points: TrendSeriesPoint[]
): TrendAnalysisBullet | null {
  const trend = computeTrend(points);
  if (trend.direction === 'unknown' || trend.delta === null || trend.currentValue === null || trend.priorValue === null) {
    return null;
  }
  const direction = trend.direction;
  const significance = trendSignificance(trend.delta, trend.priorValue);
  return {
    seriesId: id,
    label,
    direction,
    delta: trend.delta,
    currentValue: trend.currentValue,
    priorValue: trend.priorValue,
    significance,
    text: bulletText(label, direction, trend.delta, trend.currentValue, trend.priorValue, significance),
  };
}

/**
 * The pure builder: loaded series in, ranked bounded bullets out.
 *
 * Ties break on series id so the section is stable run to run - a briefing
 * whose bullet order shuffles between identical days reads as movement that
 * did not happen.
 */
export function buildTrendAnalysis(
  loaded: { id: string; label: string; points: TrendSeriesPoint[] }[],
  maxBullets: number = TREND_ANALYSIS_MAX_BULLETS
): TrendAnalysisBullet[] {
  return loaded
    .map((s) => analyseSeries(s.id, s.label, s.points))
    .filter((b): b is TrendAnalysisBullet => b !== null)
    .sort((a, b) => b.significance - a.significance || a.seriesId.localeCompare(b.seriesId))
    .slice(0, Math.max(0, maxBullets));
}

/**
 * The impure edge, kept to one function: read every registered series through
 * `loadPointsSafely` and hand the pure builder the result. The registry IS the
 * enumeration - no per-series list lives here, exactly as BL-603's board does
 * it, so a tenth series publishes itself.
 */
export function loadTrendAnalysis(
  context: TrendsBoardContext,
  sources: TrendsBoardSeriesSource[] = TRENDS_BOARD_SERIES,
  maxBullets: number = TREND_ANALYSIS_MAX_BULLETS
): TrendAnalysisBullet[] {
  return buildTrendAnalysis(
    sources.map((source) => ({
      id: source.id,
      label: source.label,
      points: loadPointsSafely(source, context),
    })),
    maxBullets
  );
}

/**
 * The section as the briefing carries it. An empty analysis renders as an
 * empty string, not as a heading with nothing under it: a section that says
 * only its own name is noise on a phone, and the briefing's optional-section
 * machinery already drops a blank one.
 */
export function renderTrendAnalysisSection(bullets: TrendAnalysisBullet[]): string {
  if (bullets.length === 0) {
    return '';
  }
  return [`${TREND_ANALYSIS_HEADING}:`, ...bullets.map((b) => `- ${b.text}`)].join('\n');
}
