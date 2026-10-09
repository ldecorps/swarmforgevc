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
  // BL-2094: the parcel's own merge-base with main, resolved ONCE in
  // composeQaGatherReport (resolveMergeBaseWithMain, the SAME runFn seam
  // every check uses) and fed to both this field and backlogOnlySkipReason
  // below - never two independent git merge-base calls for one fact
  // (BL-2094/BL-2024 integration bounce, 2026-10-09). This is the
  // property_runners row's own --changed-from ref: never the gathered
  // commit itself. QA gathers with that commit already checked out as
  // HEAD, so the front-end's own <ref>...HEAD range collapsed to empty
  // when the row passed ctx.commit directly (15 of 15 gathers since
  // BL-2073 landed read "no property runner reached since <their own
  // tip>"). undefined only when no merge-base could be resolved (no
  // common history with main) - the row blocks rather than ever falling
  // back to a wider ref (BL-2073's own rule, restated by BL-2094).
  mergeBaseWithMain?: string;
  // BL-2024: set only when the parcel's own diff (mergeBaseWithMain above
  // ..commit) is non-empty and every path starts with "backlog/" - the
  // reason the unit/properties checks' build() skip with below. undefined
  // (no merge-base resolved, or the diff touches anything else, or could
  // not be resolved) means "run as today" - the skip fails closed
  // (invariant 1).
  backlogOnlySkipReason?: string;
}

type BuiltCommand = { command: string; args: string[]; cwd: string };
type BlockedBuild = { blockedReason: string };
type SkippedBuild = { skippedReason: string };

export interface CheckSpec {
  id: string;
  build(ctx: CheckContext): BuiltCommand | BlockedBuild | SkippedBuild;
}

function isBlocked(built: BuiltCommand | BlockedBuild | SkippedBuild): built is BlockedBuild {
  return (built as BlockedBuild).blockedReason !== undefined;
}

function isSkipped(built: BuiltCommand | BlockedBuild | SkippedBuild): built is SkippedBuild {
  return (built as SkippedBuild).skippedReason !== undefined;
}

// BL-2024: a check whose build() returns this when ctx.backlogOnlySkipReason
// is set - the unit and properties checks are the only two that use it.
function skippableCommand(
  ctx: CheckContext,
  real: () => BuiltCommand
): BuiltCommand | SkippedBuild {
  return ctx.backlogOnlySkipReason ? { skippedReason: ctx.backlogOnlySkipReason } : real();
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
  {
    id: 'unit',
    build: (ctx) => skippableCommand(ctx, () => ({ command: 'npm', args: ['test'], cwd: path.join(ctx.root, 'extension') })),
  },
  {
    id: 'properties',
    build: (ctx) =>
      skippableCommand(ctx, () => ({ command: 'npm', args: ['run', 'test:properties'], cwd: path.join(ctx.root, 'extension') })),
  },
  {
    id: 'property_runners',
    build: (ctx) =>
      ctx.mergeBaseWithMain
        ? {
            command: path.join(ctx.root, 'swarmforge', 'scripts', 'test', 'run_property_runners.sh'),
            args: ['--changed-from', ctx.mergeBaseWithMain],
            cwd: ctx.root,
          }
        : { blockedReason: `could not resolve merge-base main ${ctx.commit}` },
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
  status: 'ran' | 'blocked' | 'skipped';
  exit: number | null;
  duration_ms: number;
  excerpt: string;
  reason?: string;
}

// BL-1769: exported so a fixture building "more than the excerpt keeps"
// tracks this constant rather than a hard-coded copy of it.
export const EXCERPT_MAX_CHARS = 4000;

// Hardener note (BL-2024/BL-2094 mutation passes, 2026-10-09): the
// `text.length <= maxChars` guard's own comparison mutants (false/< instead of <=/empty
// block) are accepted EQUIVALENTS, not gaps - for ANY input, `.slice`
// clamps a start index more negative than the string's own length to 0,
// so `text.slice(text.length - maxChars)` already returns the untouched
// `text` whenever text.length <= maxChars (the guard's own case), the
// same value the early return would give. No assertion on the return
// value can ever separate the mutant from the original.
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
    if (isSkipped(built)) {
      rows.push({ id: spec.id, command: '', cwd: ctx.root, status: 'skipped', exit: null, duration_ms: 0, excerpt: '', reason: built.skippedReason });
      continue;
    }
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
    // Hardener note (BL-2024/BL-2094 mutation passes, 2026-10-09): mutating
    // this `?? ''` fallback to any other FAIL-line-free string is an accepted
    // EQUIVALENT - parseFailingFilesFromVitestOutput only ever reacts to
    // a real " FAIL  <file>" line, so any fallback text lacking one
    // (including the mutator's own literal) parses to the same [].
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
  // Hardener note (BL-2024/BL-2094 mutation passes, 2026-10-09): mutating
  // this `?? []` fallback (undefined/no-register case) to a non-empty bogus
  // array is an accepted EQUIVALENT - byFile is read only via
  // `byFile.get(file)` below with `file` always a real failing-file path
  // (from a vitest FAIL line or the ticket's own acceptance: path), never
  // the bogus entry's own (non-string-`.file`-bearing) key, so the extra
  // entry is never observably reachable.
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
// Hardener note (BL-2024/BL-2094 mutation passes, 2026-10-09): two accepted
// EQUIVALENTS here. (1) dropping `rawStdout === undefined` from the guard
// below - `JSON.parse(undefined)` coerces to the string "undefined",
// which is never valid JSON, so it throws and the catch below returns
// undefined anyway: the same result the guard gives directly. (2) the
// catch block's own explicit `return undefined` vs an empty `catch {}` -
// a function with no further statement after a no-op catch implicitly
// returns undefined, identically. Both are demonstrable from the code,
// not merely from this run's own fixtures.
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

// BL-2094: the parcel's merge-base with main - the property_runners row's
// own --changed-from ref, and (BL-2024/BL-2094 integration bounce,
// 2026-10-09) the ONE git merge-base call composeQaGatherReport makes per
// gather, its result fed to backlogOnlySkipReason below too rather than
// each resolving it independently. Exported so an acceptance handler
// driving the property_runners row in isolation builds the SAME ctx field
// composeQaGatherReport does, never a restatement of the resolution.
export function resolveMergeBaseWithMain(root: string, commit: string, runFn: RunFn): string | undefined {
  const result = runFn('git', ['merge-base', 'main', commit], root);
  if (!result.started || result.exit !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

// BL-2024: the parcel's OWN changed paths - git diff --no-renames
// --name-only <base> <commit>, through the SAME injected runFn seam every
// check uses (never a second subprocess mechanism, never a
// reimplementation of what git already answers). `base` is the ALREADY-
// RESOLVED merge-base (resolveMergeBaseWithMain above, called once by the
// caller) - this never re-resolves it.
//
// QA bounce D1 (2026-10-09): --no-renames is load-bearing. git's default
// rename detection collapses a moved file into ONE line naming only the
// destination, so a parcel that renames extension/src/x.ts to backlog/x.ts
// (deleting production code) read as touching only backlog/ - invariant 1
// failing OPEN on exactly the diff shape it means to catch. --no-renames
// always lists both the old (D) and new (A) path.
function resolveChangedPaths(root: string, base: string, commit: string, runFn: RunFn): string[] | undefined {
  const diff = runFn('git', ['diff', '--no-renames', '--name-only', base, commit], root);
  if (!diff.started || diff.exit !== 0) {
    return undefined;
  }
  return diff.stdout
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function isBacklogOnlyPaths(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => p.startsWith('backlog/'));
}

// Returns a skip reason only when the diff from the (already-resolved)
// merge-base to commit is non-empty and every path in it starts with
// "backlog/" - a failed diff, an empty diff, or any path outside backlog/
// returns undefined, so the caller runs both lanes exactly as today
// (invariant 1: fails closed on any doubt).
export function backlogOnlySkipReason(root: string, base: string, commit: string, runFn: RunFn): string | undefined {
  const paths = resolveChangedPaths(root, base, commit, runFn);
  if (!paths || !isBacklogOnlyPaths(paths)) {
    return undefined;
  }
  return `the parcel's own diff touches only backlog/ (${paths.join(', ')})`;
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
  // BL-2024/BL-2094 integration bounce (2026-10-09): ONE merge-base
  // resolution per gather, fed to both fields below - never two
  // independent `git merge-base main <commit>` calls for one fact.
  const mergeBaseWithMain = resolveMergeBaseWithMain(root, opts.commit, runFn);
  const ctx: CheckContext = {
    root,
    ticketId,
    task: opts.task,
    commit: opts.commit,
    acceptanceFeature,
    mergeBaseWithMain,
    backlogOnlySkipReason: mergeBaseWithMain ? backlogOnlySkipReason(root, mergeBaseWithMain, opts.commit, runFn) : undefined,
  };
  let registerRawStdout: string | undefined;
  const rawOutputByCheckId = new Map<string, string>();
  const checks = runChecklist(CHECKLIST, ctx, runFn, (id, outcome) => {
    if (id === 'register') {
      registerRawStdout = outcome.stdout;
    }
    // Hardener note (BL-2024/BL-2094 mutation passes, 2026-10-09): widening
    // this guard to always-true is an accepted EQUIVALENT - it would only add
    // extra entries keyed by some OTHER check's id, and
    // failingFilesFromRow's own `row.id === 'unit' || row.id ===
    // 'properties'` branch (above) is the only reader of this map, so an
    // entry under any other id is never looked up. Narrowing it to
    // exclude 'properties' specifically (e.g. `id === 'unit' || id !==
    // 'properties'`) is NOT equivalent - it drops a real properties
    // row's own output, which a RED properties row's own register_join
    // test below depends on.
    if (id === 'unit' || id === 'properties') {
      rawOutputByCheckId.set(id, outcome.stdout + outcome.stderr);
    }
  });
  const register = parseRegisterOutput(checks.find((c) => c.id === 'register'), registerRawStdout);
  const register_join = buildRegisterJoin(checks, register, acceptanceFeature, rawOutputByCheckId);
  return { ticket: ticketId, task: opts.task, commit: opts.commit, root, checks, register_join };
}
