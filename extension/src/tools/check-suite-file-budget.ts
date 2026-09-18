#!/usr/bin/env node
/**
 * BL-378: guards against a single test file quietly becoming the suite's
 * next 10-second wall-clock pole. Wall clock is "slowest file + ~1s"
 * across the parallel worker pool, so ONE file breaching the budget costs
 * as much as every other file combined - and does so silently, since
 * every individual test inside it still passes (BL-078/BL-252's own
 * whole-suite trend cannot see this: it tells you the suite got slower,
 * never that one file did it). Reads Vitest's own JSON reporter output
 * (vitest run --reporter=json --outputFile=<path>) - per-file start/end
 * times are already emitted there, no second collection mechanism
 * needed. A per-TEST budget is deliberately out of scope: the unit of
 * parallelism is the FILE - a file of 200 fast tests is healthy; budgeting
 * individual tests would flag it for the wrong reason.
 *
 * Usage: node check-suite-file-budget.js <vitest-json-report-path>
 */
import * as fs from 'fs';
import * as path from 'path';
import { runCliMain } from './swarm-metrics';

// BL-378: the ONE named place for the budget number - never hardcoded or
// scattered across callers. Set from the real post-BL-375/376/377 profile
// (re-measured, not the ticket's own pre-fix estimate): the three fixed
// poles' now-real dependency-cruiser-engine tests peak around 4.2-4.8s,
// with an unrelated file (renderBriefingDiagramsCli.test.js) the current
// overall slowest at ~4.8s. 7s leaves honest headroom above that observed
// noise while still catching a file heading for the 10s this ticket
// exists to prevent.
export const PER_FILE_DURATION_BUDGET_MS = 7000;

// BL-1598 amendment (2026-09-16, specifier, on QA's Article 4.2 hold
// 93b31c8209): per-file wall durations on this lane's host drift 2 to 3x
// within hours with no code change (BL-445 documented the same jitter for
// the whole-suite wall clock). An unregistered file refusing at any
// breach of the budget is a snapshot gate that reads red on day one under
// normal jitter; it now refuses only at or above this multiple, with a
// `watch` verdict surfaced (never silently absorbed) for the band between.
export const NEW_POLE_REFUSAL_FRACTION = 1.5;

export interface FileDuration {
  file: string;
  durationMs: number;
}

export interface BudgetOffender extends FileDuration {
  budgetMs: number;
}

// Vitest's own --reporter=json shape (Jest-compatible): testResults[] has
// one entry per FILE (not per test), each carrying startTime/endTime
// epoch ms - no separate top-level per-file duration field, so it is
// computed here.
export interface VitestJsonReport {
  testResults: Array<{ name: string; startTime: number; endTime: number }>;
}

// projectRoot, when given, relativizes an ABSOLUTE r.name (vitest's real
// JSON reporter emits the file's full filesystem path, not the
// `test/foo.test.js` shorthand this module's own fixtures use) so the
// result matches backlog/suite-poles.tsv's committed, portable
// (repo-root-relative) file column. Omitted (existing callers, tests):
// r.name passes through unchanged, byte-for-byte the pre-BL-1598 behavior.
export function extractFileDurations(report: VitestJsonReport, projectRoot?: string): FileDuration[] {
  return report.testResults.map((r) => ({
    file: projectRoot && path.isAbsolute(r.name) ? path.relative(projectRoot, r.name) : r.name,
    durationMs: r.endTime - r.startTime,
  }));
}

// BL-1598: the standing-red register's own shape (BL-1428) - a committed,
// tab-separated pole register naming an OPEN ticket that owns bringing its
// file back under budget. 5 columns: file, ticket, first_seen, measured_ms,
// note. '#'-comment and blank lines skipped, mirroring
// standing_red_register_lib.bb's own parse.
export interface RegisterRow {
  file: string;
  ticket: string;
  firstSeen: string;
  measuredMs: number;
  note: string;
}

export function parseRegisterRows(text: string): RegisterRow[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [file, ticket, firstSeen, measuredMsRaw, ...noteParts] = line.split('\t');
      return { file, ticket, firstSeen, measuredMs: Number(measuredMsRaw), note: noteParts.join('\t') };
    });
}

// Open-ticket ids: a *.yaml file directly under backlogDir/paused/ or
// backlogDir/active/ (top-level only, never a nested backlog/done/ entry) -
// mirrors qa_hold_lib.bb's own open-ticket-ids-for so both readers of a
// standing-red-register-shaped TSV agree on what "open" means.
export function openTicketIds(backlogDir: string): Set<string> {
  const ids = new Set<string>();
  for (const sub of ['paused', 'active']) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(path.join(backlogDir, sub));
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.yaml')) continue;
      const match = /^(BL-\d+)/i.exec(name);
      if (match) ids.add(match[1].toUpperCase());
    }
  }
  return ids;
}

export type BudgetVerdictKind = 'ok' | 'watch' | 'stale-row' | 'unowned-row' | 'new-pole' | 'contention';

export interface FileVerdict extends BudgetOffender {
  kind: BudgetVerdictKind;
  ticket?: string;
}

// BL-1633: a would-be new-pole confirmed ALONE (its own solo duration)
// under budget - the in-suite duration above is the fork pool's
// contention, not the code, so the run passes and both numbers are
// reported (never just the in-suite one, which is what made this file
// look like a pole in the first place).
export interface ContentionVerdict extends FileVerdict {
  kind: 'contention';
  aloneMs: number;
}

export interface BudgetCheckResult {
  passed: boolean;
  verdict: BudgetVerdictKind;
  offenders: BudgetOffender[];
  watchFiles: FileVerdict[];
  staleRows: FileVerdict[];
  unownedRows: FileVerdict[];
  registeredPoles: FileVerdict[];
  contention: ContentionVerdict[];
}

// A row's file measuring under this fraction of the budget is stale: the
// pole it was minted for is gone, so the row should leave in the same land
// that cut it (BL-1598's own FIRM wording).
const STALE_ROW_FRACTION = 0.8;

// One register row's verdict, isolated from the loop that walks the whole
// register (hardener extraction, BL-1598: pulled out of
// checkFileDurationBudget to bring its CRAP back under the gate - CRAP=12
// on the un-extracted version, complexity alone, at 100% coverage). null
// means the row contributes NO verdict this run (an owned, non-stale,
// non-pole row still measuring within budget's middle band, or a row for a
// file this run never touched).
function classifyRegisterRow(row: RegisterRow, measured: number | undefined, budgetMs: number, openTickets: Set<string>): FileVerdict | null {
  if (!openTickets.has(row.ticket)) {
    return { file: row.file, durationMs: measured ?? row.measuredMs, budgetMs, kind: 'unowned-row', ticket: row.ticket };
  }
  if (measured === undefined) return null;
  if (measured < budgetMs * STALE_ROW_FRACTION) {
    return { file: row.file, durationMs: measured, budgetMs, kind: 'stale-row', ticket: row.ticket };
  }
  if (measured > budgetMs) {
    return { file: row.file, durationMs: measured, budgetMs, kind: 'ok', ticket: row.ticket };
  }
  return null;
}

// Priority order matches the amendment's own stated order (2026-09-16, QA's
// Article 4.2 hold), extended by BL-1633's 'contention' between watch and
// stale-row (2026-09-18): new-pole, unowned-row, watch, contention,
// stale-row, ok - a new, unregistered offender is worse than an existing
// row gone stale or unowned, which in turn outrank a merely-watched or
// pool-contended file, which outrank a stale one.
function computeVerdict(
  offenderCount: number,
  unownedCount: number,
  watchCount: number,
  contentionCount: number,
  staleCount: number
): BudgetVerdictKind {
  if (offenderCount > 0) return 'new-pole';
  if (unownedCount > 0) return 'unowned-row';
  if (watchCount > 0) return 'watch';
  if (contentionCount > 0) return 'contention';
  if (staleCount > 0) return 'stale-row';
  return 'ok';
}

// BL-1633: a would-be new-pole (unregistered, at or above the 1.5x refusal
// line) is refused only after a confirming SOLO measurement of that file
// also exceeds the budget - the in-suite duration alone is the fork
// pool's contention, not evidence the file itself is slow (measured:
// telegramFrontDeskBotCli.test.js, 3.7-5.0s alone vs 8.0-19.7s in-suite,
// six of eight runs over the line with zero code change). No confirmation
// argument (the four-argument callers, BL-1598's and BL-1620's own) keeps
// every candidate an offender exactly as before - confirmAlone is never
// called and this degrades to a no-op pass-through. `null` (the
// confirmer's own timeout/failure sentinel) counts as over budget alone
// (the FIRM: a confirmation that does not finish in time is never treated
// as evidence of contention). Extracted alongside classifyRegisterRows,
// same CRAP-gate reason.
function confirmOffendersAlone(
  candidates: FileDuration[],
  budgetMs: number,
  confirmAlone: ((file: string) => number | null) | undefined
): { offenders: BudgetOffender[]; contention: ContentionVerdict[] } {
  const offenders: BudgetOffender[] = [];
  const contention: ContentionVerdict[] = [];
  for (const d of candidates) {
    const aloneMs = confirmAlone ? confirmAlone(d.file) : null;
    if (confirmAlone && aloneMs !== null && aloneMs < budgetMs) {
      contention.push({ file: d.file, durationMs: d.durationMs, aloneMs, budgetMs, kind: 'contention' });
    } else {
      offenders.push({ file: d.file, durationMs: d.durationMs, budgetMs });
    }
  }
  return { offenders, contention };
}

// Walks every register row once, bucketing each into stale/unowned/pole via
// classifyRegisterRow (a null verdict contributes to none) - the loop
// itself pulled out of checkFileDurationBudget alongside classifyRegisterRow
// so the caller is left with straight-line composition, not a branching
// walk (hardener extraction, BL-1598, same CRAP-gate reason).
function classifyRegisterRows(
  register: RegisterRow[],
  durationByFile: Map<string, number>,
  budgetMs: number,
  openTickets: Set<string>
): { staleRows: FileVerdict[]; unownedRows: FileVerdict[]; registeredPoles: FileVerdict[] } {
  const staleRows: FileVerdict[] = [];
  const unownedRows: FileVerdict[] = [];
  const registeredPoles: FileVerdict[] = [];

  for (const row of register) {
    const verdict = classifyRegisterRow(row, durationByFile.get(row.file), budgetMs, openTickets);
    if (verdict === null) continue;
    if (verdict.kind === 'unowned-row') unownedRows.push(verdict);
    else if (verdict.kind === 'stale-row') staleRows.push(verdict);
    else registeredPoles.push(verdict);
  }

  return { staleRows, unownedRows, registeredPoles };
}

// Pure: the whole decision table (BL-378 scenarios 01-03, extended by
// BL-1598's register, amended 2026-09-16 on QA's Article 4.2 hold). Every
// file over budget is reported, not just the first (scenario 03) - failing
// on the first would hide the others and turn one fix into N sequential
// rediscoveries. register/openTickets default to empty.
//
// Only new-pole and unowned-row fail (`passed`); watch, contention and
// stale-row are reported on every run they occur but never refuse - a
// snapshot gate that refuses on ordinary host-load jitter (BL-445's own
// documented shape for the whole-suite wall clock) is red on day one.
// Headline verdict precedence when several apply at once: new-pole,
// unowned-row, watch, contention, stale-row, ok (the amendment's own
// stated order, extended by BL-1633).
export function checkFileDurationBudget(
  durations: FileDuration[],
  budgetMs: number,
  register: RegisterRow[] = [],
  openTickets: Set<string> = new Set(),
  confirmAlone?: (file: string) => number | null
): BudgetCheckResult {
  const durationByFile = new Map(durations.map((d) => [d.file, d.durationMs]));
  const rowByFile = new Map(register.map((r) => [r.file, r]));

  const { staleRows, unownedRows, registeredPoles } = classifyRegisterRows(register, durationByFile, budgetMs, openTickets);

  const refusalThresholdMs = budgetMs * NEW_POLE_REFUSAL_FRACTION;
  const unregisteredOverBudget = durations.filter((d) => d.durationMs > budgetMs && !rowByFile.has(d.file));
  const candidateOffenders = unregisteredOverBudget.filter((d) => d.durationMs >= refusalThresholdMs);
  const { offenders, contention } = confirmOffendersAlone(candidateOffenders, budgetMs, confirmAlone);
  const watchFiles: FileVerdict[] = unregisteredOverBudget
    .filter((d) => d.durationMs < refusalThresholdMs)
    .map((d) => ({ file: d.file, durationMs: d.durationMs, budgetMs, kind: 'watch' }));

  const passed = offenders.length === 0 && unownedRows.length === 0;
  const verdict = computeVerdict(offenders.length, unownedRows.length, watchFiles.length, contention.length, staleRows.length);

  return { passed, verdict, offenders, watchFiles, staleRows, unownedRows, registeredPoles, contention };
}

// Names the offender, its duration, AND the budget it broke (scenario 01)
// - a report that says only "too slow" sends the next person back to
// re-profile from scratch, exactly the work this ticket exists to
// eliminate.
export function formatBudgetOffenders(offenders: BudgetOffender[]): string {
  return offenders
    .map((o) => `${o.file}: ${(o.durationMs / 1000).toFixed(1)}s exceeds the ${(o.budgetMs / 1000).toFixed(1)}s per-file budget`)
    .join('\n');
}

// BL-1598: reads a run's real vitest JSON report and (when given) the
// committed pole register, and returns the SAME structured result both
// main() (the standalone CLI) and recordTestDuration.js (the in-process
// live consumer) print and record from - one decision, two callers, never
// two computations of it.
export function runGuardAgainstReport(
  reportPath: string,
  registerPath?: string,
  confirmAlone?: (file: string) => number | null
): { result: BudgetCheckResult; durations: FileDuration[] } {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as VitestJsonReport;
  const projectRoot = registerPath ? path.dirname(path.dirname(registerPath)) : undefined;
  const durations = extractFileDurations(report, projectRoot);
  const registerRows =
    registerPath && fs.existsSync(registerPath) ? parseRegisterRows(fs.readFileSync(registerPath, 'utf8')) : [];
  const openTickets = registerPath ? openTicketIds(path.dirname(registerPath)) : new Set<string>();
  const result = checkFileDurationBudget(durations, PER_FILE_DURATION_BUDGET_MS, registerRows, openTickets, confirmAlone);
  return { result, durations };
}

// A file over budget WITH an open, un-stale register row (registeredPoles),
// a stale row (file now under 80% of budget), and an unregistered file
// between the budget and NEW_POLE_REFUSAL_FRACTION (watchFiles) are all
// REPORTED, never refused - only new-pole and unowned-row refuse
// (failureLines), the amendment's own split.
// BL-1633: `result.contention` may be absent on a hand-built partial
// result (this file's own tests construct BudgetCheckResult literals
// without it) - defaulted to empty, never a throw, the same posture the
// four-argument checkFileDurationBudget callers get from confirmAlone
// being optional there.
function formatContentionVerdicts(entries: ContentionVerdict[]): string {
  return entries
    .map(
      (c) =>
        `${c.file}: ${(c.durationMs / 1000).toFixed(1)}s in-suite, ${(c.aloneMs / 1000).toFixed(1)}s alone (budget ${(c.budgetMs / 1000).toFixed(1)}s) - the pool, not the code`
    )
    .join('\n');
}

// BL-1633 hardener: pulled the contention line's own decision (present, and
// result.contention's own absent-on-a-hand-built-literal default) out of
// formatGuardReport, the same CRAP-gate reason BL-1598's own extractions
// already used (classifyRegisterRow/classifyRegisterRows beside
// checkFileDurationBudget) - formatGuardReport's own complexity was already
// AT the un-flagged ceiling (6, five pre-existing ifs) before this ticket's
// one inline `if` plus the `result.contention || []` default pushed it to 8
// and over the gate. Extracting both here restores it to 6.
function appendContentionLine(infoLines: string[], result: BudgetCheckResult): void {
  const contention = result.contention || [];
  if (contention.length > 0) {
    infoLines.push(
      `${contention.length} contention file(s) (over budget in-suite, confirmed under budget alone):\n${formatContentionVerdicts(contention)}`
    );
  }
}

export function formatGuardReport(result: BudgetCheckResult): { infoLines: string[]; failureLines: string[] } {
  const infoLines: string[] = [];
  if (result.registeredPoles.length > 0) {
    infoLines.push(
      `${result.registeredPoles.length} registered pole(s) reported, not refused:\n${formatBudgetOffenders(result.registeredPoles)}`
    );
  }
  if (result.watchFiles.length > 0) {
    infoLines.push(
      `${result.watchFiles.length} watch file(s) (unregistered, over budget but under ${NEW_POLE_REFUSAL_FRACTION}x - not refused):\n${formatBudgetOffenders(result.watchFiles)}`
    );
  }
  appendContentionLine(infoLines, result);
  if (result.staleRows.length > 0) {
    infoLines.push(
      `${result.staleRows.length} stale register row(s) (file now under 80% of budget - remove the row):\n${formatBudgetOffenders(result.staleRows)}`
    );
  }
  const failureLines: string[] = [];
  if (result.offenders.length > 0) {
    failureLines.push(`${result.offenders.length} new-pole offender(s):\n${formatBudgetOffenders(result.offenders)}`);
  }
  if (result.unownedRows.length > 0) {
    failureLines.push(
      `${result.unownedRows.length} unowned register row(s) (ticket not open):\n${result.unownedRows
        .map((r) => `${r.file}: owner ${r.ticket} is not open`)
        .join('\n')}`
    );
  }
  return { infoLines, failureLines };
}

export function printGuardReport(result: BudgetCheckResult, fileCount: number): void {
  const { infoLines, failureLines } = formatGuardReport(result);
  for (const line of infoLines) {
    console.log(line);
  }
  if (!result.passed) {
    process.stderr.write(`suite file budget exceeded:\n${failureLines.join('\n')}\n`);
    return;
  }
  console.log(`suite file budget OK: ${fileCount} files, all within ${(PER_FILE_DURATION_BUDGET_MS / 1000).toFixed(1)}s`);
}

export function main(): void {
  const reportPath = process.argv[2];
  const registerPath = process.argv[3];
  if (!reportPath) {
    process.stderr.write('Usage: node check-suite-file-budget.js <vitest-json-report-path> [register-tsv-path]\n');
    process.exitCode = 1;
    return;
  }
  const { result, durations } = runGuardAgainstReport(reportPath, registerPath);
  printGuardReport(result, durations.length);
  if (!result.passed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCliMain(main);
}
