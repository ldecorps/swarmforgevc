/**
 * BL-1015 — the report a human reads before accepting the commit. Split out
 * of `boyScoutRun.ts` (BL-485 mutation-site size).
 */

import type { NoCleanReason, RunResult } from './types';

function renderHeader(result: RunResult): string[] {
  const lines: string[] = ['BOY SCOUT RUN — one item, cleaned or refused whole', ''];
  lines.push(`items ranked: ${result.ranked}`);
  lines.push(`top-ranked item: ${result.subject ?? '(none)'}`);
  if (result.summary) lines.push(`proposed cleanup: ${result.summary}`);
  lines.push('');
  return lines;
}

function renderCleanedBody(result: RunResult): string[] {
  return [
    `outcome: CLEANED — ${result.subject}`,
    `  changed ${result.measured.files} file(s), ${result.measured.lines} line(s) ` +
      `within an envelope of ${result.envelope.files} file(s), ${result.envelope.lines} line(s)`,
    `  gates passed before commit: ${result.gate?.ran.join(', ') || 'none'}`,
    `  files: ${result.editedPaths.join(', ')}`,
    `  committed: ${result.committed ? 'yes' : 'no'}`,
  ];
}

function bannerFor(outcome: RunResult['outcome']): string {
  if (outcome === 'refused') return 'REFUSED';
  if (outcome === 'abandoned') return 'ABANDONED';
  return 'NOTHING CLEANED';
}

function renderNoCleanBody(result: RunResult): string[] {
  // Invariant 3: nothing below is ever reachable without a stated reason.
  const lines = [`outcome: ${bannerFor(result.outcome)} — ${result.reason}`, `  ${explain(result)}`];
  if (result.exceeded.length > 0) {
    lines.push(
      `  the envelope is ${result.envelope.files} file(s) and ${result.envelope.lines} line(s); ` +
        `exceeded: ${result.exceeded.join(' and ')}`
    );
  }
  lines.push('  nothing was committed; the working tree is unchanged.');
  return lines;
}

export function renderRunReport(result: RunResult): string {
  const body = result.outcome === 'cleaned' ? renderCleanedBody(result) : renderNoCleanBody(result);
  return [...renderHeader(result), ...body].join('\n') + '\n';
}

// A dispatch table, not a switch: each entry is a pure function of `result`,
// so this file carries no branching of its own - the "no reason recorded"
// fallback is a MISSING key, handled once by the lookup rather than by a
// `default:` arm, and is exercised (not merely inspectable) via a `reason`
// outside the declared set.
const EXPLANATIONS: Record<NoCleanReason, (result: RunResult) => string> = {
  'nothing-ranked': () => 'the scan ranked no debt at all, so there was no top item to clean.',
  'no-cleanup-proposed': (result) =>
    `no cleanup was proposed for ${result.subject}${result.detail ? ` (${result.detail})` : ''}.`,
  'wrong-item': (result) => `${result.detail}; a run cleans the top-ranked item or nothing.`,
  'envelope-exceeded': (result) => `${result.detail}, which is bigger than one sitting.`,
  'assertion-would-change': (result) =>
    `the cleanup could only reach green by changing an existing assertion in ${result.detail}. ` +
    'That is a behaviour change wearing a refactor\'s clothes, so it is abandoned: this item needs its own ticket.',
  'gate-failed': (result) =>
    `the repository gate set failed on the cleaned result (failed: ${result.gate?.failed.join(', ') || 'unknown'}).`,
};

function explain(result: RunResult): string {
  const formatter = result.reason && EXPLANATIONS[result.reason];
  // Unreachable by construction in a real run - every no-clean path sets a
  // declared reason - but a defensive fallback all the same, and directly
  // exercisable (not merely inspectable) via a `reason` outside the set.
  return formatter ? formatter(result) : 'no reason was recorded, which is itself a defect: a run must never be silently empty.';
}
