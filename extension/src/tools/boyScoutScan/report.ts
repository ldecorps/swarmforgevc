/**
 * BL-1014 — the report renderer. See ./index.ts for the module's overall
 * design note.
 *
 * A clean repository still names every source it consulted. An empty list
 * tells the operator nothing - it reads the same whether there is no debt or
 * the scan never looked.
 *
 * And a source that could NOT be consulted is reported as unavailable, never
 * as clean: "no CRAP debt" and "CRAP was never measured" are opposite facts,
 * and collapsing them would let the scan silently under-report.
 */

import type { ConsultedSource, DebtItem } from './types';

/** How many evidence lines one item prints before the rest are counted. */
export const EVIDENCE_SAMPLE = 5;

export function renderReport({
  ranked,
  consulted,
}: {
  ranked: DebtItem[];
  consulted: ConsultedSource[];
}): string {
  const lines: string[] = ['BOY SCOUT SCAN — debt ranked by recurrence', ''];

  lines.push('sources consulted:');
  for (const c of consulted) {
    if (!c.available) {
      lines.push(`  ${c.source}: NOT CONSULTED — ${c.why ?? 'unavailable'}`);
    } else if (c.count === 0) {
      lines.push(`  ${c.source}: clean (no signal)`);
    } else {
      lines.push(`  ${c.source}: ${c.count} signal(s)`);
    }
  }
  lines.push('');

  if (ranked.length === 0) {
    lines.push('no debt ranked.');
    return lines.join('\n') + '\n';
  }

  lines.push('ranked inventory (most recurrent first):');
  ranked.forEach((item, i) => {
    lines.push(
      `  ${i + 1}. ${item.subject} — attested by ${item.sourceCount} source(s), ${item.evidence.length} hit(s)`
    );
    // One source can produce a hundred hits for one file (a single .ts file
    // routinely has that many CRAP-flagged functions), which buries the
    // ranking the report exists to convey. The sample is bounded - and the
    // elision is STATED, because a silently shortened list reads as complete.
    for (const e of item.evidence.slice(0, EVIDENCE_SAMPLE)) {
      lines.push(`       [${e.source}] ${e.artifact}: ${e.detail}`);
    }
    if (item.evidence.length > EVIDENCE_SAMPLE) {
      lines.push(`       ... + ${item.evidence.length - EVIDENCE_SAMPLE} more (open the artifacts above)`);
    }
  });
  return lines.join('\n') + '\n';
}
