/**
 * BL-1014 — the whole scan, wiring parsers to readers through an injected
 * seam. See ./index.ts for the module's overall design note.
 */

import type { Evidence, EvidenceSourceName, ConsultedSource, ScanResult, SourceReaders } from './types';
import { mergeBySubject, rankInventory } from './rank';
import { parseHardeningLedger, parseBounceRecords, parseCrapReport, parseDuplicationReport, summarizeRuntimeBloat } from './parsers';
import { defaultReaders } from './readers';

/**
 * The whole scan, with every source read through an injected seam. A source
 * that throws is recorded as NOT CONSULTED with its reason - one broken source
 * must not silently shrink the inventory, which would read as "less debt".
 */
export function scan(root: string, readers: SourceReaders = defaultReaders): ScanResult {
  const consulted: ConsultedSource[] = [];
  const evidence: Evidence[] = [];

  const consult = (
    source: EvidenceSourceName,
    read: () => Evidence[],
    unavailableWhen?: () => string | null
  ) => {
    try {
      const why = unavailableWhen?.() ?? null;
      if (why) {
        consulted.push({ source, available: false, count: 0, why });
        return;
      }
      const found = read();
      evidence.push(...found);
      consulted.push({ source, available: true, count: found.length });
    } catch (err) {
      consulted.push({ source, available: false, count: 0, why: (err as Error).message });
    }
  };

  consult('deferred-hardening-gate', () => parseHardeningLedger(readers.hardeningLedger(root)));
  consult('bounce-recurrence', () => parseBounceRecords(readers.bounceLines(root)));

  let crapText = '';
  consult(
    'crap-over-threshold',
    () => parseCrapReport(crapText),
    () => {
      crapText = readers.crapReport(root);
      // No output at all means the report could not be produced (no coverage
      // yet). That is NOT the same as no CRAP debt, and must not read as clean.
      return crapText.trim() === '' ? 'no CRAP report available (run npm run coverage in extension/)' : null;
    }
  );

  let dryText = '';
  consult(
    'duplication',
    () => parseDuplicationReport(dryText),
    () => {
      dryText = readers.duplicationReport(root);
      return dryText.trim() === '' ? 'no duplication report available' : null;
    }
  );

  consult('runtime-bloat', () => summarizeRuntimeBloat(readers.countedPaths(root)));

  return { ranked: rankInventory(mergeBySubject(evidence)), consulted };
}
