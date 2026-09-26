// BL-1554: QA's mechanical checklist, gathered and reported in one call.
// This module GATHERS and REPORTS only - it never renders a pass/bounce
// verdict (the ticket's own FIRM constraint). Every check shells out to
// the EXISTING owner CLI or npm script through one injected runFn seam
// (never a reimplementation of what a check verifies); the register join
// reads the register CLI's own JSON output, never a second ownership rule.
//
// No fs/child_process import here: src/quality/ is the dependency-gate's
// POLICY zone (`.dependency-cruiser.cjs`'s no-io-from-policy rule, BL-259
// hard gate) - the impure IO (the default runFn, and the ticket-YAML
// lookup composeQaGatherReport's caller resolves) lives in
// src/metrics/qaGatherAdapter.ts, which depends on this module, never the
// other way around (same split as siblingDeferral.ts/siblingDeferralStore.ts
// and bounceRevertVerdict.ts/bounceRevertGitAdapter.ts).

import * as path from 'path';

export interface RunOutcome {
  started: boolean;
  exit: number | null;
  stdout: string;
  stderr: string;
  reason?: string;
}

// Synchronous by design: every real check here is a blocking subprocess
// anyway (npm test, a property lane, an acceptance run), and a plain
// sequential loop over a synchronous seam is the simplest way to make
// "never concurrently" true by construction rather than by convention.
export type RunFn = (command: string, args: string[], cwd: string) => RunOutcome;

export interface CheckContext {
  root: string;
  ticketId: string;
  task?: string;
  commit: string;
  acceptanceFeature?: string;
}

type BuiltCommand = { command: string; args: string[]; cwd: string };
type BlockedBuild = { blockedReason: string };

export interface CheckSpec {
  id: string;
  build(ctx: CheckContext): BuiltCommand | BlockedBuild;
}

function isBlocked(built: BuiltCommand | BlockedBuild): built is BlockedBuild {
  return (built as BlockedBuild).blockedReason !== undefined;
}

const STRAGGLER_PATTERN = 'node --test|stryker|vitest';

function stragglerCheck(id: string): CheckSpec {
  return { id, build: (ctx) => ({ command: 'pgrep', args: ['-fl', STRAGGLER_PATTERN], cwd: ctx.root }) };
}

// The fixed checklist, in the fixed order (invariant 3). Each build()
// returns either the real command to run or a blocked reason - a
// prerequisite this ticket's own tool can see is missing (e.g. no --task)
// never even attempts a runFn call.
export const CHECKLIST: CheckSpec[] = [
  stragglerCheck('stragglers_before'),
  {
    id: 'sibling',
    build: (ctx) => ({
      command: 'node',
      args: [path.join('extension', 'out', 'tools', 'qa-sibling-check.js'), 'status', '--ticket', ctx.ticketId],
      cwd: ctx.root,
    }),
  },
  {
    id: 'register',
    build: (ctx) => ({
      command: 'bb',
      args: [path.join('swarmforge', 'scripts', 'standing_red_register_cli.bb'), ctx.root],
      cwd: ctx.root,
    }),
  },
  {
    id: 'wiring',
    build: (ctx) =>
      ctx.task
        ? { command: path.join(ctx.root, 'swarmforge', 'scripts', 'pre_qa_gate.sh'), args: [ctx.task, ctx.commit, ctx.root], cwd: ctx.root }
        : { blockedReason: '--task was not given; the wiring check needs a task name' },
  },
  { id: 'unit', build: (ctx) => ({ command: 'npm', args: ['test'], cwd: path.join(ctx.root, 'extension') }) },
  {
    id: 'properties',
    build: (ctx) => ({ command: 'npm', args: ['run', 'test:properties'], cwd: path.join(ctx.root, 'extension') }),
  },
  {
    id: 'acceptance',
    build: (ctx) =>
      ctx.acceptanceFeature
        ? { command: path.join(ctx.root, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh'), args: [ctx.acceptanceFeature], cwd: ctx.root }
        : { blockedReason: `ticket ${ctx.ticketId} declares no acceptance: path` },
  },
  stragglerCheck('stragglers_after'),
];

export interface CheckRow {
  id: string;
  command: string;
  cwd: string;
  status: 'ran' | 'blocked';
  exit: number | null;
  duration_ms: number;
  excerpt: string;
  reason?: string;
}

// BL-1769: exported so a fixture building "more than the excerpt keeps"
// tracks this constant rather than a hard-coded copy of it.
export const EXCERPT_MAX_CHARS = 4000;

export function tailExcerpt(text: string, maxChars: number = EXCERPT_MAX_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(text.length - maxChars);
}

function fullCommand(built: BuiltCommand): string {
  return [built.command, ...built.args].join(' ');
}

// Pure: given the checklist and a context, drives runFn sequentially (a
// plain for-of, never Promise.all/concurrent scheduling) and returns each
// check's row - never a verdict (invariant 1). Exported separately from
// gatherQaChecklist below so a caller (or a test) can pass a checklist
// subset without touching the real one.
//
// BL-1554 architect bounce D1: a check's `excerpt` is BOUNDED for display
// (tailExcerpt, EXCERPT_MAX_CHARS) - fine for a human-facing report, wrong
// as a machine-parsed source (the register check's own JSON stdout, once
// past ~4000 chars, gets its opening structure sliced off by tailExcerpt's
// keep-the-tail bounding, so JSON.parse throws and the register silently
// reads as empty). `onRawOutcome`, called only for a check that actually
// ran, hands the caller the UNBOUNDED outcome before it is ever passed
// through tailExcerpt - the one seam a caller needs for a check whose
// stdout must be parsed, not merely displayed, never a second runFn call
// (which would double the register CLI's real subprocess cost and break
// the "exactly once per check" sequencing invariant).
export function runChecklist(
  checklist: CheckSpec[],
  ctx: CheckContext,
  runFn: RunFn,
  onRawOutcome?: (id: string, outcome: RunOutcome) => void
): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const spec of checklist) {
    const built = spec.build(ctx);
    if (isBlocked(built)) {
      rows.push({ id: spec.id, command: '', cwd: ctx.root, status: 'blocked', exit: null, duration_ms: 0, excerpt: '', reason: built.blockedReason });
      continue;
    }
    const startedAt = Date.now();
    const outcome = runFn(built.command, built.args, built.cwd);
    const duration_ms = Date.now() - startedAt;
    if (!outcome.started) {
      rows.push({
        id: spec.id,
        command: fullCommand(built),
        cwd: built.cwd,
        status: 'blocked',
        exit: null,
        duration_ms,
        excerpt: '',
        reason: outcome.reason ?? 'could not start',
      });
      continue;
    }
    onRawOutcome?.(spec.id, outcome);
    rows.push({
      id: spec.id,
      command: fullCommand(built),
      cwd: built.cwd,
      status: 'ran',
      exit: outcome.exit,
      duration_ms,
      excerpt: tailExcerpt(outcome.stdout + outcome.stderr),
    });
  }
  return rows;
}

// ── register join ─────────────────────────────────────────────────────

export interface RegisterRow {
  lane: string;
  file: string;
  ticket: string;
  first_seen: string;
  age_days: number;
  owned: boolean;
}

export interface RegisterReport {
  rows: RegisterRow[];
}

export type RegisterJoinKind = 'owned' | 'unowned' | 'absent' | 'unidentified';

export interface RegisterJoinEntry {
  file: string;
  join: RegisterJoinKind;
  ticket?: string;
}

// The same vitest failure-line shape both the unit and property lanes
// print - never a second parser per lane. Matches the file path vitest
// itself prints after "FAIL", the shape this repo's own suites produce.
const VITEST_FAIL_LINE = /FAIL\s+(\S+?\.(?:test|property\.test)\.[jt]sx?)\b/g;

export function parseFailingFilesFromVitestOutput(text: string): string[] {
  const files = new Set<string>();
  let m: RegExpExecArray | null;
  VITEST_FAIL_LINE.lastIndex = 0;
  while ((m = VITEST_FAIL_LINE.exec(text)) !== null) {
    files.add(m[1]);
  }
  return [...files];
}

// The failing-file names a check row names, by the check's own id - unit
// and properties parse their vitest-shaped output; acceptance names its
// own declared feature path when the row's exit is non-zero (the .feature
// file IS the acceptance run's identifying test file - it has no vitest
// FAIL-line shape to parse).
// Isolated from failingFilesFromRow below (hardener extraction, BL-1554
// CRAP gate: complexity 7 at 100% coverage on the un-extracted version,
// complexity alone) - the acceptance row's own "is this a failure worth
// naming" test, no different in meaning, just out of the caller's count.
function isFailingAcceptanceRow(row: CheckRow, acceptanceFeature: string | undefined): boolean {
  return row.id === 'acceptance' && row.exit !== 0 && !!acceptanceFeature;
}

// Unit/properties rows run vitest with cwd: extension/, so the FAIL line's
// file is bare (test/...) - the register's own rows are always repo-root-
// relative (extension/test/...). Idempotent: a path a caller already
// supplies pre-prefixed (e.g. existing fixtures) is left alone.
function toRepoRootRelative(file: string): string {
  return file.startsWith('extension/') ? file : `extension/${file}`;
}

// BL-1769: unit/properties rows parse from their WHOLE (unbounded) output,
// never row.excerpt (BL-1554 architect bounce D1's own fix, applied to the
// register check only, left this one on the display-bounded excerpt) - a
// red run whose stderr crowds the last EXCERPT_MAX_CHARS with allowlisted
// noise (e.g. BL-871's onTaskUpdate timeouts) pushed the FAIL line itself
// out of the tail, so the join came back empty and read as "no failing
// file" (BL-1726, BL-1766). rawOutputByCheckId is composeQaGatherReport's
// own onRawOutcome capture, the same seam parseRegisterOutput already uses
// for the register check - never a second runFn call.
export function failingFilesFromRow(
  row: CheckRow,
  acceptanceFeature: string | undefined,
  rawOutputByCheckId: ReadonlyMap<string, string>
): string[] {
  if (row.status !== 'ran') {
    return [];
  }
  if (row.id === 'unit' || row.id === 'properties') {
    return parseFailingFilesFromVitestOutput(rawOutputByCheckId.get(row.id) ?? '').map(toRepoRootRelative);
  }
  if (isFailingAcceptanceRow(row, acceptanceFeature)) {
    return [acceptanceFeature as string];
  }
  return [];
}

// A red (non-zero exit) unit/properties row is the only shape that can
// ever go "unidentified" below - a row this parser could plausibly name a
// failing file for, but did not, on this run's own output.
function isRedParseableRow(row: CheckRow): boolean {
  return row.status === 'ran' && row.exit !== null && row.exit !== 0 && (row.id === 'unit' || row.id === 'properties');
}

// BL-1769 (hardener extraction, CRAP): the collection half of
// buildRegisterJoin's own invariant - a red unit/properties row always
// contributes at least one entry, each failing file it names, or (when it
// names none at all) one `unidentified` entry keyed by the check id, never
// a silent omission that reads as "nothing failed". Pulled out so
// buildRegisterJoin's own complexity does not grow past its pre-BL-1769
// baseline (differential complexity gate, engineering.prompt).
function collectFailingAndUnidentified(
  rows: CheckRow[],
  acceptanceFeature: string | undefined,
  rawOutputByCheckId: ReadonlyMap<string, string>
): { failing: Set<string>; unidentifiedChecks: Set<string> } {
  const failing = new Set<string>();
  const unidentifiedChecks = new Set<string>();
  for (const row of rows) {
    const files = failingFilesFromRow(row, acceptanceFeature, rawOutputByCheckId);
    if (files.length > 0) {
      for (const f of files) {
        failing.add(f);
      }
    } else if (isRedParseableRow(row)) {
      unidentifiedChecks.add(row.id);
    }
  }
  return { failing, unidentifiedChecks };
}

export function buildRegisterJoin(
  rows: CheckRow[],
  register: RegisterReport | undefined,
  acceptanceFeature: string | undefined,
  rawOutputByCheckId: ReadonlyMap<string, string>
): RegisterJoinEntry[] {
  const byFile = new Map<string, RegisterRow>();
  for (const r of register?.rows ?? []) {
    byFile.set(r.file, r);
  }
  const { failing, unidentifiedChecks } = collectFailingAndUnidentified(rows, acceptanceFeature, rawOutputByCheckId);
  const namedEntries = [...failing].sort().map((file) => {
    const row = byFile.get(file);
    if (!row) {
      return { file, join: 'absent' as const };
    }
    return { file, join: (row.owned ? 'owned' : 'unowned') as RegisterJoinKind, ticket: row.ticket };
  });
  const unidentifiedEntries = [...unidentifiedChecks].sort().map((id) => ({ file: id, join: 'unidentified' as const }));
  return [...namedEntries, ...unidentifiedEntries];
}

// Parses the register check's own RAW (unbounded) stdout, never the row's
// bounded-for-display `excerpt` (BL-1554 architect bounce D1) - a register
// large enough to cross EXCERPT_MAX_CHARS must still resolve every row.
export function parseRegisterOutput(row: CheckRow | undefined, rawStdout: string | undefined): RegisterReport | undefined {
  if (!row || row.status !== 'ran' || row.exit === null || rawStdout === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(rawStdout) as RegisterReport;
  } catch {
    return undefined;
  }
}

// ── ticket YAML: the one field this tool reads for itself ──────────────

// Mirrors task_scope_gate_lib.bb's own declared-acceptance-path exactly
// (single-line scalar only; a block form declares no comparable path) -
// never a second, independently-maintained notion of what a ticket
// declares as its acceptance contract.
export function readAcceptancePath(yamlContent: string): string | undefined {
  for (const line of yamlContent.split('\n')) {
    if (line.startsWith('acceptance:')) {
      const value = line.slice('acceptance:'.length).trim();
      if (!value || value.startsWith('|') || value.startsWith('>')) {
        return undefined;
      }
      return value.replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

// ── the report ───────────────────────────────────────────────────────

export interface QaGatherReport {
  ticket: string;
  task?: string;
  commit: string;
  root: string;
  checks: CheckRow[];
  register_join: RegisterJoinEntry[];
}

// The pure composition core: given the ticket's own landed YAML content
// (already read by the impure caller - qaGatherAdapter.ts's
// gatherQaChecklist), resolves the acceptance: path and drives the fixed
// checklist through runFn. Never renders a verdict - the report is exactly
// checks + register_join.
export function composeQaGatherReport(
  root: string,
  ticketId: string,
  opts: { task?: string; commit: string },
  runFn: RunFn,
  yamlContent: string | undefined
): QaGatherReport {
  const acceptanceFeature = yamlContent ? readAcceptancePath(yamlContent) : undefined;
  const ctx: CheckContext = { root, ticketId, task: opts.task, commit: opts.commit, acceptanceFeature };
  let registerRawStdout: string | undefined;
  const rawOutputByCheckId = new Map<string, string>();
  const checks = runChecklist(CHECKLIST, ctx, runFn, (id, outcome) => {
    if (id === 'register') {
      registerRawStdout = outcome.stdout;
    }
    if (id === 'unit' || id === 'properties') {
      rawOutputByCheckId.set(id, outcome.stdout + outcome.stderr);
    }
  });
  const register = parseRegisterOutput(checks.find((c) => c.id === 'register'), registerRawStdout);
  const register_join = buildRegisterJoin(checks, register, acceptanceFeature, rawOutputByCheckId);
  return { ticket: ticketId, task: opts.task, commit: opts.commit, root, checks, register_join };
}
