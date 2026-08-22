/**
 * BL-1015 — the report a human reads before accepting the commit. Split out
 * of `boyScoutRun.ts` (BL-485 mutation-site size).
 */

import type { RunResult } from './types';

export function renderRunReport(result: RunResult): string {
  const lines: string[] = ['BOY SCOUT RUN — one item, cleaned or refused whole', ''];

  lines.push(`items ranked: ${result.ranked}`);
  lines.push(`top-ranked item: ${result.subject ?? '(none)'}`);
  if (result.summary) lines.push(`proposed cleanup: ${result.summary}`);
  lines.push('');

  if (result.outcome === 'cleaned') {
    lines.push(`outcome: CLEANED — ${result.subject}`);
    lines.push(`  changed ${result.measured.files} file(s), ${result.measured.lines} line(s) ` +
      `within an envelope of ${result.envelope.files} file(s), ${result.envelope.lines} line(s)`);
    lines.push(`  gates passed before commit: ${result.gate?.ran.join(', ') || 'none'}`);
    lines.push(`  files: ${result.editedPaths.join(', ')}`);
    lines.push(`  committed: ${result.committed ? 'yes' : 'no'}`);
    return lines.join('\n') + '\n';
  }

  // Invariant 3: nothing below is ever reachable without a stated reason.
  const banner = result.outcome === 'refused' ? 'REFUSED' : result.outcome === 'abandoned' ? 'ABANDONED' : 'NOTHING CLEANED';
  lines.push(`outcome: ${banner} — ${result.reason}`);
  lines.push(`  ${explain(result)}`);
  if (result.exceeded.length > 0) {
    lines.push(
      `  the envelope is ${result.envelope.files} file(s) and ${result.envelope.lines} line(s); ` +
        `exceeded: ${result.exceeded.join(' and ')}`
    );
  }
  lines.push('  nothing was committed; the working tree is unchanged.');
  return lines.join('\n') + '\n';
}

function explain(result: RunResult): string {
  switch (result.reason) {
    case 'nothing-ranked':
      return 'the scan ranked no debt at all, so there was no top item to clean.';
    case 'no-cleanup-proposed':
      return `no cleanup was proposed for ${result.subject}${result.detail ? ` (${result.detail})` : ''}.`;
    case 'wrong-item':
      return `${result.detail}; a run cleans the top-ranked item or nothing.`;
    case 'envelope-exceeded':
      return `${result.detail}, which is bigger than one sitting.`;
    case 'assertion-would-change':
      return (
        `the cleanup could only reach green by changing an existing assertion in ${result.detail}. ` +
        'That is a behaviour change wearing a refactor\'s clothes, so it is abandoned: this item needs its own ticket.'
      );
    case 'gate-failed':
      return `the repository gate set failed on the cleaned result (failed: ${result.gate?.failed.join(', ') || 'unknown'}).`;
    default:
      // Unreachable by construction — every no-clean path above sets a reason.
      return 'no reason was recorded, which is itself a defect: a run must never be silently empty.';
  }
}
