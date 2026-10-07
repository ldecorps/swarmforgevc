#!/usr/bin/env node
/**
 * BL-658: live night closing ceremony driver. handoffd.bb shells this when
 * the ceremony gate reports mode=ceremony so due nights actually freeze,
 * drain/park, rotate+instruct the documenter, confirm .sent.json, then
 * night-stop — not merely log closing-ceremony-due.
 *
 * Usage: node night-closing-ceremony-run.js [--conf <path>] [--target <path>] [--now <epoch-ms>] [--dry-run]
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { atomicWrite } from '../util/atomicWrite';
import { writeControlPauseState } from './telegram-front-desk-bot';
import { evaluateGate } from './night-closing-ceremony-gate';
import {
  advanceNightClosingCeremony,
  briefingInstruction,
  withForcedBriefingStep,
  type LiveAction,
  type LiveState,
} from '../quality/nightClosingCeremonyLive';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';
// BL-1393: the lean pass is a STEP of this sequence now, not a second
// mechanism that finish-shift called on its own. Importing it here is what
// makes "one ceremony" true rather than asserted.
import { runClosingCeremony, closingCeremonyLoudCodes } from '../metrics/closingCeremonyRun';
import { sendNoteViaHandoff } from './closing-ceremony-run';
import { draftPathUnder, removeDraftIfPresent } from '../swarm/draftPathUnder';

export type RunDeps = {
  readConf: (confPath: string) => string;
  evaluate: typeof evaluateGate;
  readState: (target: string) => LiveState | null;
  writeState: (target: string, state: LiveState) => void;
  scanInFlight: (target: string) => { count: number; roles: string[] };
  scanHeld: (target: string) => string[];
  readActiveRole: (target: string) => string | null;
  briefingSent: (target: string, dayKey: string) => boolean;
  applyFreeze: (target: string, untilMs: number) => void;
  rotateDocumenter: (target: string) => void;
  instructBriefing: (target: string, dayKey: string) => void;
  nightStop: (target: string) => void;
  surface: (target: string, code: string) => void;
  recordCnp: (target: string, held: string[]) => void;
  /**
   * BL-1393: the lean pass, run as a step of this sequence.
   * BL-1528: returns the loud-log codes its own run produced (e.g. an
   * undeliverable packet send) so the caller can surface them AND fold them
   * into the written night state's `loudSurfaces` - the pure state machine
   * cannot predict these ahead of the send, unlike its own `surface` actions.
   * BL-1967: nowMs is the real instant this tick is running at, recorded as
   * the ceremony run's deliveredAt/windowEnd - never a synthetic midnight
   * derived from shiftKey.
   */
  deliverLeanPacket: (target: string, shiftKey: string, nowMs: number) => string[];
  /** BL-1393: a sleep after no work still ends in a recorded outcome. BL-1528: see deliverLeanPacket. */
  recordEmptyOutcome: (target: string, shiftKey: string, nowMs: number) => string[];
  /**
   * BL-1393: has the swarm worked a shift since the last ceremony? True when a
   * shift-start stamp is newer than the newest recorded ceremony outcome.
   */
  workedAShift: (target: string) => boolean;
  /**
   * BL-1641/BL-1836: land the documenter branch's own commit for the day's
   * briefing when one exists (byte-identical, touching only that one path)
   * and main does not already have the file. Called on every briefing-phase
   * tick, so the briefing lands the moment it exists. Returns the LANDING
   * commit's sha, or null when nothing was landed (main already has the
   * file, no qualifying documenter commit exists, or the tool/branch is
   * unavailable).
   */
  landDocumenterBriefing: (target: string, dayKey: string) => string | null;
  /** BL-1836: does main carry the day's briefing? Fails closed (see mainHasBriefing). */
  mainHasBriefing: (target: string, dayKey: string) => boolean;
};

function statePath(target: string): string {
  return path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-state.json');
}

function readLiveState(target: string): LiveState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(target), 'utf8')) as LiveState;
  } catch {
    return null;
  }
}

function writeLiveState(target: string, state: LiveState): void {
  const file = statePath(target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(state, null, 2)}\n`);
}

function listHandoffs(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((n) => n.endsWith('.handoff'));
}

function scanInFlight(target: string): { count: number; roles: string[] } {
  const rolesRoot = path.join(target, '.swarmforge', 'handoffs');
  // Per-role mailboxes live under worktrees; daemon fixture uses shared inbox.
  const shared = listHandoffs(path.join(rolesRoot, 'inbox', 'in_process'));
  const roles: string[] = [];
  if (shared.length > 0) {
    roles.push('resident');
  }
  // Also scan sibling role worktree markers when roles.tsv lists wt paths —
  // best-effort: count shared in_process as the drain signal.
  return { count: shared.length, roles };
}

function scanHeld(target: string): string[] {
  return listHandoffs(path.join(target, '.swarmforge', 'handoffs', 'inbox', 'new'));
}

function readActiveRole(target: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(target, '.swarmforge', 'mono-router-active-role'), 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

// BL-1836: the email sweep (briefing_email_lib.bb's load-sent-briefings /
// record-briefing-sent!) writes {"sent": ["<day>.md", ...]}. The ceremony read
// a bare list and never matched, so every ceremony ran to its deadline. The
// key is pinned on both sides by a test (BL-897).
export const SENT_LEDGER_KEY = 'sent';

export function briefingSent(target: string, dayKey: string): boolean {
  const sentPath = path.join(target, 'docs', 'briefings', '.sent.json');
  try {
    const ledger = JSON.parse(fs.readFileSync(sentPath, 'utf8')) as Record<string, unknown> | null;
    const sent = ledger && !Array.isArray(ledger) ? ledger[SENT_LEDGER_KEY] : null;
    return Array.isArray(sent) && sent.some((name) => name === `${dayKey}.md`);
  } catch {
    return false;
  }
}

// Hotfix 2026-09-16: `rotate_to_role.sh documenter` is the resident-invoked
// rotation entry (handoff_lib.bb's respawn-as!, BL-805) - it REFUSES
// (nonzero exit) when the resident holds a real, undrained in_process
// parcel, exactly the normal case while the ceremony fires mid-work.
//
// BL-1753 (2026-09-26, the human's ruling B): a refused rotate is retried
// ONCE with SWARMFORGE_ROTATE_FORCE=1 (handoff_lib.bb's own documented
// override) instead of spawning documenter's own second session beside
// the resident (the removed fallback - "mono-router = one resident",
// same ruling BL-1752 already applied to the chase). The parcel the
// resident held stays in its own role's in_process untouched - the force
// override rotates the PANE, never touches that mailbox - and resumes
// next time that role is played (ready_for_next.sh checks in_process
// first). If even the forced rotate fails (no session, no launch
// script), this function does nothing further: BL-1641's own
// hard-deadline path (BL-1836: the loud closing-briefing-missing,
// night-stop) is the unchanged safety net. No note to coordinator either
// (dropped, not kept - coordinator cannot respawn a pane it does not own,
// so the old note was inert whether or not a session followed it, and
// the forced rotate above either already did the job or BL-1641 will).
export function rotateDocumenter(target: string): void {
  const rotate = path.join(target, 'swarmforge', 'scripts', 'rotate_to_role.sh');
  if (!fs.existsSync(rotate)) {
    return;
  }
  const run = (force: boolean): boolean => {
    try {
      execFileSync('bash', [rotate, 'documenter'], {
        cwd: target,
        env: { ...process.env, SWARMFORGE_ROLE: 'coordinator', ...(force ? { SWARMFORGE_ROTATE_FORCE: '1' } : {}) },
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  };
  if (run(false)) {
    return;
  }
  run(true);
}

export function sendHandoffNote(target: string, to: string, message: string): void {
  const draftPath = draftPathUnder(target, 'closing-ceremony');
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(
    draftPath,
    `type: note\nto: ${to}\npriority: 00\nmessage: ${message.slice(0, 80)}\n`,
    'utf8'
  );
  try {
    const script = path.join(target, 'swarmforge', 'scripts', 'swarm_handoff.sh');
    if (!fs.existsSync(script)) {
      // Fixture roots may lack scripts — write a loud marker instead.
      const marker = path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-notes.log');
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.appendFileSync(marker, `${to}: ${message}\n`);
      return;
    }
    execFileSync(script, [draftPath], {
      cwd: target,
      env: { ...process.env, SWARMFORGE_ROLE: 'coordinator', SWARMFORGE_SKIP_DAEMON: '1' },
      stdio: 'pipe',
    });
  } finally {
    removeDraftIfPresent(draftPath);
  }
}

// BL-1528: a 'lean-packet'/'record-empty-outcome' action's own send outcome
// is handed to deps.surface, same as a statically-decided 'surface' action,
// then returned for applyAction's caller to fold into loudSurfaces.
function surfaceLoudCodes(target: string, deps: RunDeps, codes: string[]): string[] {
  for (const code of codes) {
    deps.surface(target, code);
  }
  return codes;
}

// BL-1528: fold runtime-discovered loud codes into a state's loudSurfaces -
// split out so runNightClosingCeremony's own branching count stays at its
// pre-BL-1528 baseline (differential complexity gate, hardener.prompt).
function withRuntimeLoudCodes(state: LiveState, runtimeLoudCodes: string[]): LiveState {
  return runtimeLoudCodes.length > 0 ? { ...state, loudSurfaces: [...state.loudSurfaces, ...runtimeLoudCodes] } : state;
}

// BL-1836: in the briefing phase, land the documenter's own briefing commit
// before observing, so the pure machine sees it on main from the tick it
// exists. The ceremony never composes a briefing itself (the human's ruling
// A, 2026-09-30). Returns the step name to fold into the written sequence
// via withForcedBriefingStep, or null - split out for the same
// differential-complexity reason as withRuntimeLoudCodes above.
function landBriefingIfDue(target: string, prev: LiveState | null, nightKey: string, deps: RunDeps, dryRun: boolean): string | null {
  if (dryRun || prev === null || prev.nightKey !== nightKey || prev.phase !== 'briefing') {
    return null;
  }
  return deps.landDocumenterBriefing(target, nightKey) ? 'briefing-landed-from-documenter' : null;
}

// BL-1676: a switch's cyclomatic complexity is driven by its case count
// (8, pushing applyAction's own CRAP over the gate's threshold regardless of
// coverage) - a data-driven dispatch table collapses that to one lookup, same
// shape as telegramCursorBridgeLive.ts's INBOUND_ACTION_HANDLERS. Each
// per-kind handler is its own trivial (complexity 1) function; the
// Record<LiveAction['kind'], ...> type keeps the table exhaustive at compile
// time, same guarantee the switch's cases gave.
type ActionHandler = (target: string, action: LiveAction, deps: RunDeps, nowMs: number) => string[];

const ACTION_HANDLERS: Record<LiveAction['kind'], ActionHandler> = {
  freeze: (target, action, deps) => {
    deps.applyFreeze(target, (action as Extract<LiveAction, { kind: 'freeze' }>).untilMs);
    return [];
  },
  surface: (target, action, deps) => {
    deps.surface(target, (action as Extract<LiveAction, { kind: 'surface' }>).code);
    return [];
  },
  'record-cnp': (target, action, deps) => {
    deps.recordCnp(target, (action as Extract<LiveAction, { kind: 'record-cnp' }>).heldParcelIds);
    return [];
  },
  'rotate-documenter': (target, _action, deps) => {
    deps.rotateDocumenter(target);
    return [];
  },
  'instruct-briefing': (target, action, deps) => {
    deps.instructBriefing(target, (action as Extract<LiveAction, { kind: 'instruct-briefing' }>).dayKey);
    return [];
  },
  // BL-1528: the send's own outcome is handed to deps.surface, same as a
  // statically-decided 'surface' action, then returned to fold into loudSurfaces.
  'lean-packet': (target, action, deps, nowMs) => {
    const a = action as Extract<LiveAction, { kind: 'lean-packet' }>;
    return surfaceLoudCodes(target, deps, deps.deliverLeanPacket(target, a.shiftKey, nowMs));
  },
  'record-empty-outcome': (target, action, deps, nowMs) => {
    const a = action as Extract<LiveAction, { kind: 'record-empty-outcome' }>;
    return surfaceLoudCodes(target, deps, deps.recordEmptyOutcome(target, a.shiftKey, nowMs));
  },
  'night-stop': (target, _action, deps) => {
    deps.nightStop(target);
    return [];
  },
};

// BL-1528: returns the loud codes a 'lean-packet'/'record-empty-outcome'
// action's own send outcome produced - [] for every other kind.
function applyAction(target: string, action: LiveAction, deps: RunDeps, dryRun: boolean, nowMs: number): string[] {
  if (dryRun) {
    return [];
  }
  const handler = ACTION_HANDLERS[action.kind];
  return handler ? handler(target, action, deps, nowMs) : [];
}

export function buildRealDeps(): RunDeps {
  return {
    readConf: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''),
    evaluate: evaluateGate,
    readState: readLiveState,
    writeState: writeLiveState,
    scanInFlight,
    scanHeld,
    readActiveRole,
    briefingSent,
    applyFreeze: (target, untilMs) => {
      writeControlPauseState(target, { active: true, untilMs }, 'night-closing-ceremony');
    },
    rotateDocumenter,
    instructBriefing: (target, dayKey) => {
      sendHandoffNote(target, 'documenter', briefingInstruction(dayKey));
    },
    nightStop: (target) => {
      const stopFile = path.join(target, '.swarmforge', 'daemon', 'stop');
      fs.mkdirSync(path.dirname(stopFile), { recursive: true });
      atomicWrite(stopFile, 'closing-ceremony\n');
      const kill = path.join(target, 'swarmforge', 'scripts', 'kill_all_swarm.sh');
      if (fs.existsSync(kill)) {
        try {
          execFileSync('bash', [kill, target], { cwd: target, stdio: 'pipe' });
        } catch {
          // stop file is the durable signal; kill is best-effort
        }
      }
    },
    surface: (target, code) => {
      const log = path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-loud.log');
      fs.mkdirSync(path.dirname(log), { recursive: true });
      fs.appendFileSync(log, `${new Date().toISOString()} ${code}\n`);
    },
    recordCnp: (target, held) => {
      const file = path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-cnp.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      atomicWrite(file, `${JSON.stringify({ heldParcelIds: held, at: Date.now() }, null, 2)}\n`);
    },
    deliverLeanPacket: (target, shiftKey, nowMs) => {
      // The BL-820 pass itself, unchanged: it folds the lifecycle ledger into
      // the shift packet and delivers it to the specifier, or records an
      // explicit no-change outcome for an empty shift. BL-1528: a refused
      // send is reported back as a loud code, never thrown. BL-1967: the
      // real instant this tick ran at, not a synthetic midnight - shiftKey
      // (the night path's own local day key) is passed through unchanged so
      // the run's file/fold key never moves off it.
      const result = runClosingCeremony(target, new Date(nowMs).toISOString(), { sendNote: sendNoteViaHandoff }, 'specifier', shiftKey);
      return closingCeremonyLoudCodes(result);
    },
    recordEmptyOutcome: (target, shiftKey, nowMs) => {
      // Same recorder, same store: a sleep after no work is one auto_no_change
      // run, distinguishable from a ceremony that never happened at all.
      const result = runClosingCeremony(target, new Date(nowMs).toISOString(), { sendNote: sendNoteViaHandoff }, 'specifier', shiftKey);
      return closingCeremonyLoudCodes(result);
    },
    workedAShift: (target) => shiftWorkedSinceLastCeremony(target),
    landDocumenterBriefing,
    mainHasBriefing,
  };
}

// ── BL-1641/BL-1836: land the documenter's own briefing ──────────────────

const DOCUMENTER_BRANCH_TSV_COLUMN = 3;

function briefingRelPath(dayKey: string): string {
  return path.join('docs', 'briefings', `${dayKey}.md`);
}

// `git cat-file -e main:<path>` exits non-zero (128) both when the path is
// genuinely absent from an otherwise-readable `main` AND on every other
// git-level failure (missing/corrupt `main` ref, "not a git repository",
// a transient I/O error) - the exit code alone cannot tell these apart
// (BL-1641 architect bounce D1, empirically confirmed: both a missing path
// and a missing repository exit 128). Only git's own stderr wording
// distinguishes "the ref resolved fine but this path is not in it" from
// every other failure shape.
const GIT_PATH_ABSENT_FROM_MAIN_PATTERN = /fatal: path ['"].*['"] does not exist in ['"]main['"]/;

// Absent on main: the check must fail closed on any git error (including
// "not a repository") - a broken read must never read as "safe to write".
// Only the SPECIFIC "path does not exist in main" stderr shape - a genuine
// absence with `main` itself resolved fine - reads as false (absent);
// every other failure (a missing/corrupt ref, no repository, anything
// unrecognised) reads as true (main might already have it, so no write
// happens).
// Exported separately from buildRealDeps (same precedent as
// rotateDocumenter above) so a test can drive the fail-open/
// fail-closed distinction directly against a real git fixture, without
// needing a full commit_integrity_cli.bb-writing pipeline just to observe
// this guard's own decision.
export function mainHasBriefing(target: string, dayKey: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `main:${briefingRelPath(dayKey)}`], {
      cwd: target,
      stdio: 'pipe',
    });
    return true;
  } catch (err) {
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
    return !GIT_PATH_ABSENT_FROM_MAIN_PATTERN.test(stderr);
  }
}

// BL-1641: "the documenter worktree's branch name comes from roles.tsv, not
// a literal" - roles.tsv's own column order (role, worktree-name, wt-path,
// branch, display-name, ...), same file swarmState.ts's parseRolesTsv reads
// (that parser does not expose the branch column, so it is read directly
// here rather than growing a shared type for this one caller's narrow need).
function documenterBranchName(target: string): string | null {
  try {
    const rolesTsv = fs.readFileSync(path.join(target, '.swarmforge', 'roles.tsv'), 'utf8');
    for (const line of rolesTsv.split('\n')) {
      const cols = line.split('\t');
      if (cols[0] === 'documenter' && cols[DOCUMENTER_BRANCH_TSV_COLUMN]) {
        return cols[DOCUMENTER_BRANCH_TSV_COLUMN];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function gitOutput(target: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: target, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return null;
  }
}

// BL-1641 invariant 1 (second half - "a forced briefing commit touches
// exactly that one absent path and nothing else"): pure, property-tested in
// isolation from the git shelling that produces `touchedPaths`.
export function documenterCommitIsPureAdd(touchedPaths: string[], relPath: string): boolean {
  return touchedPaths.length === 1 && touchedPaths[0] === relPath;
}

export function landDocumenterBriefing(target: string, dayKey: string): string | null {
  // Invariant 1 (first half): never touch a briefing main already has. This
  // early return is the whole guard - no git write below it is reachable
  // once main already has the file, which is what makes the guarantee true
  // by construction rather than by one more condition to keep in sync.
  if (mainHasBriefing(target, dayKey)) {
    return null;
  }
  const branch = documenterBranchName(target);
  if (!branch) {
    return null;
  }
  const relPath = briefingRelPath(dayKey);
  const sha = gitOutput(target, ['log', branch, '-1', '--format=%H', '--', relPath]);
  const trimmedSha = sha ? sha.trim() : '';
  if (!trimmedSha) {
    return null;
  }
  const touched = gitOutput(target, ['diff-tree', '--no-commit-id', '--name-only', '-r', trimmedSha]);
  const touchedPaths = (touched ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  // "adds only <path>": the commit's WHOLE diff is that one path, nothing else.
  if (!documenterCommitIsPureAdd(touchedPaths, relPath)) {
    return null;
  }
  const blob = gitOutput(target, ['show', `${trimmedSha}:${relPath}`]);
  if (blob === null) {
    return null;
  }
  const absPath = path.join(target, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, blob);
  const commitCli = path.join(target, 'swarmforge', 'scripts', 'commit_integrity_cli.bb');
  if (!fs.existsSync(commitCli)) {
    // Fixture roots may lack the tool - degrade quietly, same posture as
    // sendHandoffNote's own missing-script branch.
    return null;
  }
  try {
    execFileSync(
      'bb',
      [
        commitCli,
        target,
        '--message',
        `Closing ceremony: land documenter briefing ${dayKey} (from ${trimmedSha.slice(0, 10)})`,
        '--path',
        relPath,
      ],
      { cwd: target, stdio: 'pipe' }
    );
    return trimmedSha;
  } catch {
    return null;
  }
}

/**
 * BL-1393: "at least one shift of work since the last ceremony", read from
 * what the swarm ALREADY writes rather than from a new bookkeeping file some
 * path could forget to update. `.swarmforge/swarm-identity` is rewritten by
 * swarmforge.sh on every launch, so its mtime IS the shift start; every
 * recorded ceremony outcome lands in `.swarmforge/lean/ceremony/<shiftKey>.json`.
 *
 * `.swarmforge/shift-started` is read first and is the explicit form. Nothing
 * writes it today: adding that one line to swarmforge.sh is refused by
 * BL-1328's property test, which requires every added executable line in that
 * file to sit inside ITS detection helper - a guard pinned to one parcel's
 * diff and now binding on every later one (surfaced in this parcel's evidence,
 * not fixed here). Honouring the path anyway costs nothing and means whoever
 * lifts that guard need only add the stamp.
 *
 * Fails OPEN - true when it cannot tell. A missing stamp on a swarm that has
 * been working all day must never silence the ceremony; the empty-outcome path
 * is for a swarm that demonstrably did nothing, not for a probe that failed.
 */
export function shiftWorkedSinceLastCeremony(target: string): boolean {
  const startedAt = newestMtimeMs([
    path.join(target, '.swarmforge', 'shift-started'),
    path.join(target, '.swarmforge', 'swarm-identity'),
  ]);
  if (startedAt === null) {
    return true;
  }
  const ceremonyDir = path.join(target, '.swarmforge', 'lean', 'ceremony');
  let lastCeremonyAt: number | null = null;
  try {
    lastCeremonyAt = newestMtimeMs(
      fs.readdirSync(ceremonyDir).map((name) => path.join(ceremonyDir, name))
    );
  } catch {
    lastCeremonyAt = null;
  }
  return lastCeremonyAt === null || startedAt > lastCeremonyAt;
}

function newestMtimeMs(paths: string[]): number | null {
  let newest: number | null = null;
  for (const p of paths) {
    try {
      const at = fs.statSync(p).mtimeMs;
      if (newest === null || at > newest) {
        newest = at;
      }
    } catch {
      // absent is not an error here: the caller decides what absence means.
    }
  }
  return newest;
}

export function parseArgs(argv: string[]): {
  confPath: string | null;
  target: string | null;
  nowMs: number;
  dryRun: boolean;
  sleepPath: string | null;
} {
  let confPath: string | null = null;
  let target: string | null = null;
  let nowMs = Date.now();
  let dryRun = false;
  // BL-1393: the caller IS the trigger. finish-shift, a crontab bedtime and
  // night-stop are sleeps whatever the hour, so they say so and the gate's
  // overnight window does not get to veto them; the daemon keeps passing
  // nothing and keeps being gated by its window.
  let sleepPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--conf' && argv[i + 1] !== undefined) {
      confPath = argv[++i];
    } else if (argv[i] === '--target' && argv[i + 1] !== undefined) {
      target = argv[++i];
    } else if (argv[i] === '--now' && argv[i + 1] !== undefined) {
      nowMs = Number(argv[++i]);
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--sleep-path' && argv[i + 1] !== undefined) {
      sleepPath = argv[++i];
    }
  }
  return { confPath, target, nowMs, dryRun, sleepPath };
}

function localDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseHmToMs(nowMs: number, hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(nowMs);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// BL-1393: a sleep is a sleep whatever the hour - finish-shift at 17:00 on a
// weekday runs the same ceremony the daemon runs at 06:00. Only the DAEMON's
// trigger (sleepPath === null) is gated by the closure window.
function gateBypassed(gateMode: string, sleepPath: string | null): boolean {
  return gateMode !== 'ceremony' && sleepPath === null;
}

// A sleep caller's own trigger always counts as due, regardless of the
// daemon's closure-window gate.
function ceremonyIsDue(gateCeremonyDue: unknown, sleepPath: string | null): boolean {
  return Boolean(gateCeremonyDue) || sleepPath !== null;
}

function gateModeLabel(gateMode: string, sleepPath: string | null): string {
  return sleepPath === null ? gateMode : `sleep:${sleepPath}`;
}

const DEFAULT_DRAIN_BUDGET_MINUTES = 25;
const DEFAULT_BRIEFING_BUDGET_MINUTES = 10;

// BL-1640: a sleep's deadlines are relative to ITS OWN start time, never to
// the daemon's closure-scheduled stop time - a sleep at 16:00 must never
// inherit a hard deadline that (like the morning's 08:45) has already
// passed. The daemon's own window arithmetic (parseHmToMs against
// closureStopLocal, a hardcoded 25-minute drain) is unchanged - this path
// is reached only when sleepPath is set.
function sleepRelativeDeadlines(
  nowMs: number,
  gate: { drainBudgetMinutes?: number; briefingBudgetMinutes?: number }
): { drainBudgetMs: number; hardDeadlineMs: number } {
  const drainMinutes = gate.drainBudgetMinutes ?? DEFAULT_DRAIN_BUDGET_MINUTES;
  const briefingMinutes = gate.briefingBudgetMinutes ?? DEFAULT_BRIEFING_BUDGET_MINUTES;
  const drainBudgetMs = drainMinutes * 60_000;
  return { drainBudgetMs, hardDeadlineMs: nowMs + drainBudgetMs + briefingMinutes * 60_000 };
}

// BL-1640: a sleep path gets deadlines relative to its own start; the
// daemon's own window path keeps parseHmToMs against closureStopLocal.
// Extracted so `runNightClosingCeremony`'s own complexity does not carry
// this branch's decision point (differential complexity gate, workflow.prompt).
function resolveCeremonyDeadlines(
  nowMs: number,
  gate: { drainBudgetMinutes?: number; briefingBudgetMinutes?: number; closureStopLocal?: string },
  sleepPath: string | null
): { drainBudgetMs: number; hardDeadlineMs: number } {
  if (sleepPath !== null) {
    return sleepRelativeDeadlines(nowMs, gate);
  }
  return { drainBudgetMs: 25 * 60_000, hardDeadlineMs: parseHmToMs(nowMs, gate.closureStopLocal ?? '06:00') };
}

// BL-1676: split out of runNightClosingCeremony to keep its own CRAP under
// the gate (each extra `&&` is its own branch point) - same differential-
// complexity reasoning as withRuntimeLoudCodes/landBriefingIfDue above.
function isContinuingInProgressNight(prev: LiveState | null, nightKey: string): boolean {
  return prev !== null && prev.nightKey === nightKey && prev.phase !== 'done' && prev.phase !== 'idle';
}

// BL-1676: same reasoning - the `||` and `??` in the final return each add a
// branch point to whichever function evaluates them.
function ceremonyHasAdvanced(actions: LiveAction[], finalState: LiveState, prev: LiveState | null): boolean {
  return actions.length > 0 || finalState.phase !== (prev?.phase ?? 'idle');
}

export function runNightClosingCeremony(
  target: string,
  confPath: string,
  nowMs: number,
  deps: RunDeps,
  dryRun = false,
  sleepPath: string | null = null
): { gateMode: string; advanced: boolean; state: LiveState | null; actions: LiveAction[] } {
  const conf = deps.readConf(confPath);
  const gate = deps.evaluate(conf, nowMs);
  if (gateBypassed(gate.mode, sleepPath)) {
    // Reachable only when sleepPath === null, so the label is always gate.mode.
    return { gateMode: gate.mode, advanced: false, state: deps.readState(target), actions: [] };
  }

  const nightKey = localDayKey(nowMs);
  const { drainBudgetMs, hardDeadlineMs } = resolveCeremonyDeadlines(nowMs, gate, sleepPath);
  const prev = deps.readState(target);
  const landedStep = landBriefingIfDue(target, prev, nightKey, deps, dryRun);
  const flight = deps.scanInFlight(target);
  const obs = {
    nowMs,
    nightKey,
    dayKey: nightKey,
    ceremonyDue: ceremonyIsDue(gate.ceremonyDue, sleepPath),
    drainBudgetMs,
    hardDeadlineMs,
    inFlightCount: flight.count,
    activeRole: deps.readActiveRole(target),
    heldParcelIds: deps.scanHeld(target),
    briefingAlreadySent: deps.briefingSent(target, nightKey),
    briefingOnMain: deps.mainHasBriefing(target, nightKey),
    workedAShift: deps.workedAShift(target),
    fromSleep: sleepPath !== null,
  };

  // Continue in-progress nights even outside the begin window.
  if (isContinuingInProgressNight(prev, nightKey)) {
    obs.ceremonyDue = true;
  }

  const { state, actions } = advanceNightClosingCeremony(prev, obs);
  const runtimeLoudCodes: string[] = [];
  for (const action of actions) {
    runtimeLoudCodes.push(...applyAction(target, action, deps, dryRun, nowMs));
  }
  // BL-1528: a send's own outcome (unlike a 'surface' action) is unknown
  // until applyAction runs it, so these codes join loudSurfaces here rather
  // than inside advanceNightClosingCeremony's pure decision. BL-1836: same
  // reasoning for whether the documenter's briefing was landed this tick.
  const finalState = withForcedBriefingStep(withRuntimeLoudCodes(state, runtimeLoudCodes), landedStep);
  if (!dryRun) {
    deps.writeState(target, finalState);
  }
  return { gateMode: gateModeLabel(gate.mode, sleepPath), advanced: ceremonyHasAdvanced(actions, finalState, prev), state: finalState, actions };
}

export async function main(): Promise<void> {
  const { projectRoot } = resolveCliMainWorktreeContext();
  const { confPath, target, nowMs, dryRun, sleepPath } = parseArgs(process.argv.slice(2));
  const root = target ?? projectRoot;
  const conf = confPath ?? path.join(projectRoot, 'swarmforge', 'swarmforge.conf');
  const result = runNightClosingCeremony(root, conf, nowMs, buildRealDeps(), dryRun, sleepPath);
  printJsonToStdout(result);
}

if (require.main === module) {
  runCliMain(main);
}
