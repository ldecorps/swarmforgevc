#!/usr/bin/env node
/**
 * BL-619: the compiled CLI half of the "morning briefing leads with a
 * token-burn warning" briefing section - the established 3-step pattern
 * (this compiled TS CLI + handoffd.bb's shell-out adapter +
 * briefing_email_lib.bb's leading/appended section wiring).
 *
 * Composes burnProjection.ts's pure composeBurnSection (fed by
 * usageAnchorStore.ts's recorded anchors, swarmforge.conf's weekly reset
 * schedule, and burnRate.ts's local transcript-derived tokens/hr) into the
 * text burnSectionText.ts's pure formatBurnSectionText produces. This file
 * owns ONLY wiring those pieces together and printing JSON - every decision
 * and every string is a pure, independently-tested function elsewhere.
 *
 * Usage: node token-burn-section.js [--now <epoch-ms>]
 *   --now <epoch-ms>  Injected clock for e2e verification without waiting
 *                     for a real instant - same seam convention as
 *                     apply-cooldown-pause.js. Defaults to Date.now().
 *
 * Prints {kind, leadingText, appendedText, subjectMarker, warning?} JSON.
 * A malformed reset config additionally writes a loud stderr warning
 * (malformed-reset-config-08).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseWeekResetConfig, composeBurnSection } from '../metrics/burnProjection';
import { readUsageAnchors, DEFAULT_ANCHOR_SCOPE } from '../metrics/usageAnchorStore';
import { computeBurnRateForRoles } from '../metrics/burnRate';
import { formatBurnSectionText, BurnSectionText } from '../metrics/burnSectionText';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';

export function parseNowArg(argv: string[], defaultNowMs: number): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--now' && argv[i + 1] !== undefined) {
      return Number(argv[i + 1]);
    }
  }
  return defaultNowMs;
}

function weekResetConfPath(projectRoot: string): string {
  return path.join(projectRoot, 'swarmforge', 'swarmforge.conf');
}

// Degrades to malformed (never throws) on a missing/unreadable conf file,
// same posture as readCooldownConfigFromDisk - parseWeekResetConfig itself
// already treats an empty string as "absent, use defaults", so a missing
// file is NOT malformed on its own.
function readWeekResetConfigFromDisk(projectRoot: string) {
  let content = '';
  try {
    content = fs.readFileSync(weekResetConfPath(projectRoot), 'utf8');
  } catch {
    content = '';
  }
  return parseWeekResetConfig(content);
}

function sumLocalBurnRateTokensPerHour(ratesByRole: Record<string, number>): number {
  return Object.values(ratesByRole).reduce((sum, rate) => sum + rate, 0);
}

export function main(): void {
  const { projectRoot, roleWorktrees } = resolveCliMainWorktreeContext();
  const nowMs = parseNowArg(process.argv.slice(2), Date.now());

  const resetConfig = readWeekResetConfigFromDisk(projectRoot);
  const anchors = readUsageAnchors(projectRoot);
  const localBurnRateTokensPerHour = sumLocalBurnRateTokensPerHour(computeBurnRateForRoles(projectRoot, roleWorktrees, nowMs));

  const result = composeBurnSection({
    anchors,
    nowMs,
    resetConfig,
    localBurnRateTokensPerHour,
    anchorScope: DEFAULT_ANCHOR_SCOPE,
  });
  const text: BurnSectionText = formatBurnSectionText(result, DEFAULT_ANCHOR_SCOPE);

  if (text.warning) {
    process.stderr.write(`malformed usage week reset config: ${text.warning}\n`);
  }
  printJsonToStdout(text);
}

if (require.main === module) {
  runCliMain(main);
}
