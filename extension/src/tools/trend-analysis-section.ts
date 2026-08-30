#!/usr/bin/env node
/**
 * BL-604: prints the morning briefing's TREND ANALYSIS section.
 *
 * The section shape every briefing sibling already uses: a thin compiled CLI
 * that prints text, shelled to by a two-line `*-briefing-section` fn in
 * handoffd.bb, reached through one key in briefing_email_lib.bb's
 * `optional-section-adapter-keys`.
 *
 * `main()` is a thin wrapper over exported, testable helpers (the shared
 * engineering rule): every decision is in ../metrics/trendAnalysis.ts and every
 * seam this CLI needs - the clock, the project root, the registry - is an
 * argument with a default, so a unit test drives it in-process without
 * chdir'ing or stubbing a global.
 *
 * Usage: node trend-analysis-section.js [project-root]
 */
import { loadTrendAnalysis, renderTrendAnalysisSection, TREND_ANALYSIS_MAX_BULLETS } from '../metrics/trendAnalysis';
import { TrendsBoardSeriesSource } from '../metrics/trendsBoard';
import { TRENDS_BOARD_SERIES } from '../metrics/trendsBoardRegistry';
import { resolveProjectRoot, runCliMain } from './swarm-metrics';

export interface TrendAnalysisSectionDeps {
  sources?: TrendsBoardSeriesSource[];
  nowMs?: number;
  maxBullets?: number;
}

export function trendAnalysisSectionText(targetPath: string, deps: TrendAnalysisSectionDeps = {}): string {
  return renderTrendAnalysisSection(
    loadTrendAnalysis(
      { targetPath, nowMs: deps.nowMs ?? Date.now() },
      deps.sources ?? TRENDS_BOARD_SERIES,
      deps.maxBullets ?? TREND_ANALYSIS_MAX_BULLETS
    )
  );
}

export function main(argv: readonly string[] = process.argv.slice(2), cwd: string = process.cwd()): void {
  const projectRoot = argv[0] ? argv[0] : resolveProjectRoot(cwd);
  const text = trendAnalysisSectionText(projectRoot);
  // An empty analysis prints nothing at all. The briefing's optional-section
  // machinery drops a blank section, and a heading with no bullets under it
  // would be the "no change" report invariant 2 forbids, wearing a different
  // hat: it tells the reader the trends were looked at and found quiet, when
  // in fact none of them had two periods to compare.
  if (text) {
    console.log(text);
  }
}

if (require.main === module) {
  runCliMain(() => main());
}
