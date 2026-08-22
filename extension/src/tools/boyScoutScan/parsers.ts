/**
 * BL-1014 — source parsers (pure over already-read data). See ./index.ts for
 * the module's overall design note.
 */

import type { CountedPath, Evidence, HardeningLedgerRow } from './types';

const LEDGER_ARTIFACT = 'backlog/hardening-debt-ledger.yaml';

/**
 * Every subject is a REPO-relative path, so the same file gets the same key in
 * every source and can corroborate itself.
 *
 * This is load-bearing, not tidying. The ledger records
 * "extension/src/tools/x.ts" while crapReport.js and jscpd both print paths
 * relative to extension/ ("src/tools/x.ts"). Left alone, one file has two keys
 * and recurrence across sources - the entire rank key - can never fire for it.
 * Every unit test passed with that defect in place, because each used
 * self-consistent subject strings; only running the scan against this
 * repository showed it.
 */
export function normalizeSubject(raw: string): string {
  const p = raw.trim().replace(/^\.\//, '');
  return p.startsWith('src/') ? `extension/${p}` : p;
}

/**
 * A deferred gate is debt by construction: the ledger records only gates that
 * did NOT run. Rows arrive already decoded by hardening_debt_ledger_read.bb -
 * that ledger's own header forbids parsing the YAML directly.
 */
export function parseHardeningLedger(rows: HardeningLedgerRow[]): Evidence[] {
  return rows.flatMap((row) =>
    (row.file_set ?? []).map((file) => ({
      subject: file,
      source: 'deferred-hardening-gate' as const,
      artifact: LEDGER_ARTIFACT,
      detail: `${row.parcel} deferred the ${row.gate} gate${row.detected_at ? ` on ${row.detected_at}` : ''}`,
    }))
  );
}

/**
 * Hardener split (CRAP): the per-line parse/validate/build was inlined into
 * parseBounceRecords' loop, which alone pushed its cyclomatic complexity to 7
 * (CRAP 7.00 at 100% coverage - coverage was never the problem, the branch
 * count was). Extracted as its own pure, behavior-preserving helper so each
 * function's CRAP is measured on its own branches, not the sum of both.
 */
function parseBounceLine(line: string): Evidence | null {
  if (!line.trim()) return null;
  let rec: { producingRole?: string; failureClass?: string; ticket?: string };
  try {
    rec = JSON.parse(line);
  } catch {
    // Forgiving reader, same convention as the other record readers here: a
    // malformed or half-written line is skipped, never thrown.
    return null;
  }
  if (!rec.failureClass || !rec.producingRole) return null;
  return {
    subject: `${rec.failureClass}/${rec.producingRole}`,
    source: 'bounce-recurrence',
    artifact: '.swarmforge/bounces/',
    detail: `${rec.ticket ?? 'unknown ticket'} bounced for ${rec.failureClass} against ${rec.producingRole}`,
  };
}

/**
 * HONEST LIMIT, stated rather than worked around: bounce records carry
 * ticket, producingRole, ticketType, failureClass, commit and at - but NOT the
 * files touched. So this slice ranks bounce recurrence by CLASS and ROLE only.
 * Per-file attribution needs a join through each commit and is deferred on the
 * epic; inventing a file here would be a rank nobody could check.
 */
export function parseBounceRecords(lines: string[]): Evidence[] {
  const out: Evidence[] = [];
  for (const line of lines) {
    const ev = parseBounceLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

/**
 * crapReport.js prints one TSV row per function and marks the ones over
 * threshold. Only the marked rows are debt - reading the score and re-deciding
 * here would duplicate the threshold in a second place.
 */
export function parseCrapReport(tsv: string): Evidence[] {
  const out: Evidence[] = [];
  for (const line of tsv.split('\n')) {
    if (!line.includes('CRAP >')) continue;
    const [file, fn, , , crap] = line.split('\t');
    if (!file || !fn) continue;
    out.push({
      subject: normalizeSubject(file),
      source: 'crap-over-threshold',
      artifact: 'npm run crap (extension/)',
      detail: `${fn.trim()} ${(crap ?? '').trim().replace(/\s*\*\*\*.*$/, '')}`,
    });
  }
  return out;
}

/**
 * A clone implicates BOTH files, so each is attested - a duplication ranked
 * against only one end would under-count the other half of the same debt.
 */
export function parseDuplicationReport(text: string): Evidence[] {
  const out: Evidence[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/([\w./-]+\.ts)\s*\[(\d+):\d+\s*-\s*(\d+):\d+\]/);
    if (!m) continue;
    out.push({
      subject: normalizeSubject(m[1]),
      source: 'duplication',
      artifact: 'npm run dry (extension/)',
      detail: `clone at lines ${m[2]}-${m[3]}`,
    });
  }
  return out;
}

/**
 * Runtime/ops bloat: a counted path over its own threshold. The count is the
 * evidence - a human re-runs the same count to check the rank.
 */
export function summarizeRuntimeBloat(counted: CountedPath[]): Evidence[] {
  return counted
    .filter((c) => c.count > c.threshold)
    .map((c) => ({
      subject: c.path,
      source: 'runtime-bloat' as const,
      artifact: c.path,
      detail: `${c.count} entries (threshold ${c.threshold})`,
    }));
}
