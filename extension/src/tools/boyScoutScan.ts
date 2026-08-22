/**
 * BL-1014 — Boy Scout slice 1: a deterministic, read-only scan that ranks
 * technical debt by RECURRENCE across the five evidence sources this repo
 * already keeps.
 *
 * Why recurrence and not severity: debt that costs once is just debt. Debt
 * that costs again and again is what the operator experiences as annoying,
 * and it is the only definition of "most annoying" that is measurable rather
 * than re-argued every run. Severity would be a fresh judgement call each
 * time, which invariant 1 (deterministic) forbids outright.
 *
 * Scope boundary: this slice RANKS and REPORTS. It never edits, never mints a
 * ticket and never cleans - that is BL-1015. Everything here is pure over
 * already-read data except the thin readers at the bottom, which only read.
 */

export const EVIDENCE_SOURCES = [
  'deferred-hardening-gate',
  'bounce-recurrence',
  'crap-over-threshold',
  'duplication',
  'runtime-bloat',
] as const;

export type EvidenceSourceName = (typeof EVIDENCE_SOURCES)[number];

/** One source's attestation that `subject` is carrying debt. */
export interface Evidence {
  subject: string;
  source: EvidenceSourceName;
  /** The artifact a human opens to check this without re-running the scan. */
  artifact: string;
  /** Enough detail to find the row/line inside that artifact. */
  detail: string;
}

export interface DebtItem {
  subject: string;
  /** DISTINCT sources attesting this subject - the rank key. */
  sourceCount: number;
  evidence: Evidence[];
}

export interface ConsultedSource {
  source: EvidenceSourceName;
  /** False when the source could not be read at all - never the same as clean. */
  available: boolean;
  count: number;
  why?: string;
}

// ── the rank key ───────────────────────────────────────────────────────────

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

// ── source parsers (pure over already-read data) ───────────────────────────

export interface HardeningLedgerRow {
  parcel: string;
  gate: string;
  file_set: string[];
  reason?: string;
  detected_at?: string;
}

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
 * HONEST LIMIT, stated rather than worked around: bounce records carry
 * ticket, producingRole, ticketType, failureClass, commit and at - but NOT the
 * files touched. So this slice ranks bounce recurrence by CLASS and ROLE only.
 * Per-file attribution needs a join through each commit and is deferred on the
 * epic; inventing a file here would be a rank nobody could check.
 */
export function parseBounceRecords(lines: string[]): Evidence[] {
  const out: Evidence[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: { producingRole?: string; failureClass?: string; ticket?: string };
    try {
      rec = JSON.parse(line);
    } catch {
      // Forgiving reader, same convention as the other record readers here: a
      // malformed or half-written line is skipped, never thrown.
      continue;
    }
    if (!rec.failureClass || !rec.producingRole) continue;
    out.push({
      subject: `${rec.failureClass}/${rec.producingRole}`,
      source: 'bounce-recurrence',
      artifact: '.swarmforge/bounces/',
      detail: `${rec.ticket ?? 'unknown ticket'} bounced for ${rec.failureClass} against ${rec.producingRole}`,
    });
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

export interface CountedPath {
  path: string;
  count: number;
  threshold: number;
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

// ── the report ─────────────────────────────────────────────────────────────

/**
 * A clean repository still names every source it consulted. An empty list
 * tells the operator nothing - it reads the same whether there is no debt or
 * the scan never looked.
 *
 * And a source that could NOT be consulted is reported as unavailable, never
 * as clean: "no CRAP debt" and "CRAP was never measured" are opposite facts,
 * and collapsing them would let the scan silently under-report.
 */
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

// ── readers (the only IO, and it only reads) ───────────────────────────────
// Each reader is injected as a seam so the ranking above is drivable with no
// repository at all, and so a source that is simply not available on this
// checkout degrades to `available: false` rather than taking the scan down.

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export interface SourceReaders {
  hardeningLedger(root: string): HardeningLedgerRow[];
  bounceLines(root: string): string[];
  crapReport(root: string): string;
  duplicationReport(root: string): string;
  countedPaths(root: string): CountedPath[];
}

/**
 * The ledger is read through its OWN CLI, hardening_debt_ledger_read.bb, and
 * never by parsing the YAML: that ledger's header says so explicitly, and its
 * reader already decodes file_set into an array so no caller re-parses the
 * on-disk row shape. Shelling out is also what keeps this read-only - the
 * reader takes no write path.
 */
export function readHardeningLedger(root: string): HardeningLedgerRow[] {
  const cli = path.join(root, 'swarmforge', 'scripts', 'hardening_debt_ledger_read.bb');
  if (!fs.existsSync(cli)) return [];
  const out = execFileSync('bb', [cli, root], { encoding: 'utf8' });
  const rows = JSON.parse(out);
  return Array.isArray(rows) ? rows : [];
}

export function readBounceLines(root: string): string[] {
  const dir = path.join(root, '.swarmforge', 'bounces');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()                       // deterministic order, never readdir order
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n'));
}

/**
 * crapReport.js READS the existing coverage report and prints; it writes
 * nothing, so running it keeps the scan read-only. It exits non-zero when
 * functions are flagged - that is its gate behaviour, not a failure, so the
 * stdout is taken either way. With no coverage report it exits 1 having
 * printed nothing, which surfaces as an unavailable source rather than as
 * "clean".
 */
export function readCrapReport(root: string): string {
  const script = path.join(root, 'extension', 'scripts', 'crapReport.js');
  if (!fs.existsSync(script)) return '';
  try {
    return execFileSync('node', [script], { cwd: path.join(root, 'extension'), encoding: 'utf8' });
  } catch (err) {
    const e = err as { stdout?: string };
    return typeof e.stdout === 'string' ? e.stdout : '';
  }
}

export function readDuplicationReport(root: string): string {
  const ext = path.join(root, 'extension');
  if (!fs.existsSync(path.join(ext, '.jscpd.json'))) return '';
  try {
    return execFileSync('npx', ['jscpd', '--config', '.jscpd.json', 'src'], {
      cwd: ext,
      encoding: 'utf8',
    });
  } catch (err) {
    const e = err as { stdout?: string };
    return typeof e.stdout === 'string' ? e.stdout : '';
  }
}

/**
 * Runtime/ops bloat. Thresholds are declared here rather than discovered, so
 * two runs over the same tree agree; the operator's own 2026-08-21 examples
 * (694 rotated handoffd archives, a 797-entry daemon dir) sit well above them.
 */
export const BLOAT_THRESHOLDS: Array<{ rel: string; threshold: number }> = [
  { rel: '.swarmforge/daemon', threshold: 100 },
  { rel: '.swarmforge/handoffs/inbox/completed', threshold: 500 },
  { rel: '.swarmforge/bounces', threshold: 200 },
];

export function readCountedPaths(root: string): CountedPath[] {
  return BLOAT_THRESHOLDS.map(({ rel, threshold }) => {
    const dir = path.join(root, rel);
    const count = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    return { path: rel, count, threshold };
  });
}

export const defaultReaders: SourceReaders = {
  hardeningLedger: readHardeningLedger,
  bounceLines: readBounceLines,
  crapReport: readCrapReport,
  duplicationReport: readDuplicationReport,
  countedPaths: readCountedPaths,
};

export interface ScanResult {
  ranked: DebtItem[];
  consulted: ConsultedSource[];
}

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

/**
 * CLI entry. Deliberately thin - it resolves a root, calls `scan`, and prints.
 * Everything worth testing is above and is exercised in-process.
 */
export function main(argv: string[] = process.argv.slice(2), cwd: string = process.cwd()): number {
  const root = argv[0] ? path.resolve(argv[0]) : cwd;
  const result = scan(root);
  process.stdout.write(renderReport(result));
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
