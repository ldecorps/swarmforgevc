/**
 * BL-1014 — the rank key. See ./index.ts for the module's overall design note.
 */

import type { DebtItem, Evidence } from './types';

/**
 * Group attestations by subject. `sourceCount` counts DISTINCT sources, not
 * rows: three rows from one source is one source's opinion, and counting rows
 * would let a single chatty source outrank genuine cross-source recurrence -
 * exactly the corroboration the rank key exists to measure.
 */
export function mergeBySubject(evidence: Evidence[]): DebtItem[] {
  const bySubject = new Map<string, Evidence[]>();
  for (const e of evidence) {
    const list = bySubject.get(e.subject);
    if (list) list.push(e);
    else bySubject.set(e.subject, [e]);
  }
  return [...bySubject.entries()].map(([subject, list]) => ({
    subject,
    sourceCount: new Set(list.map((e) => e.source)).size,
    // Evidence is ordered so two runs over the same state render identically.
    evidence: [...list].sort(
      (a, b) => a.source.localeCompare(b.source) || a.detail.localeCompare(b.detail)
    ),
  }));
}

/**
 * Rank by recurrence, descending. Every tie-break is a total order over the
 * data itself - no clock, no randomness, no input-order dependence - so the
 * same repository state always produces the same ranking (invariant 1).
 */
export function rankInventory(items: DebtItem[]): DebtItem[] {
  return [...items].sort(
    (a, b) =>
      b.sourceCount - a.sourceCount ||
      b.evidence.length - a.evidence.length ||
      a.subject.localeCompare(b.subject)
  );
}
