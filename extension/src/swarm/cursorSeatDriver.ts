// BL-713 (slice A of BL-712): the Cursor seat driver.
//
// Maps ONE role seat's lifecycle onto an agent session: boot with the role's
// prompt bundle, take a wake, run ready_for_next.sh, hand the parcel to the
// session, send the handoff through swarm_handoff.sh, report a stop reason.
//
// THREE INVARIANTS SHAPE THIS MODULE (BL-713 declares them; the property test
// beside it encodes them):
//
//  1. The seat reaches the swarm ONLY through the helpers and mailbox every
//     other agent uses. That is enforced structurally rather than by review:
//     every side effect goes through the injected `SeatDeps` seam set, the
//     only two helpers it can name are `ready_for_next` and `swarm_handoff`,
//     and the only paths it ever writes are the seat's own worktree
//     `tmp/handoff.txt` and its transcript file. There is no code path here
//     that can reach an inbox directory.
//
//  2. Every decision comes from a STRUCTURED session signal. `decideNextStep`
//     is a pure function of a `SessionSignal` — it takes no deps, so it has
//     nothing to scrape even if it wanted to. Rendered pane text is not an
//     input anywhere in this module; the transcript is an OUTPUT, written for
//     a human, and never read back to decide anything.
//
//  3. An identity that is not certified in the Model Steward registry cannot
//     be selected for a production pack. Admission runs FIRST, before the
//     prompt bundle is composed or a session opened, and fails closed: an
//     absent, malformed or statusless registry entry is `unknown`, which is
//     refused exactly like an explicit candidate.
//
// The spike-only escape is deliberately narrow. It is the presence of an
// EXACT environment value that makes a run a spike; anything else — unset,
// empty, "true", "0", a stray space — leaves the run production, where only a
// certified identity is admitted.

import * as path from 'path';
import { PIPELINE_CHAIN, nextActiveRole } from './rolePack';

// ── the spike-only escape ─────────────────────────────────────────────────

export const CURSOR_SEAT_SPIKE_ESCAPE_ENV = 'SWARMFORGE_CURSOR_SEAT_SPIKE';
export const CURSOR_SEAT_SPIKE_ESCAPE_VALUE = '1';

export const MODEL_STEWARD_REGISTRY_RELATIVE_PATH = '.swarmforge/model-steward/registry.json';

// Roles that live in the master checkout rather than their own worktree
// (Article 1: coordinator and specifier share master).
const MASTER_RESIDENT_ROLES = new Set(['coordinator', 'specifier']);

// ── identity and certification ────────────────────────────────────────────

export interface CursorIdentity {
  provider: string;
  model: string;
}

export type IdentityStatus = 'certified' | 'candidate' | 'retired' | 'unknown';

export type PackPosture = 'production' | 'spike';

export function identityKey(identity: CursorIdentity): string {
  return `${identity.provider}/${identity.model}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The identity's status as the Model Steward registry records it. Fails
 * CLOSED at every step — an unreadable registry, a missing `models` map, an
 * absent entry, an entry with no `status`, or a status that is not one this
 * driver understands all report `unknown`, which admission refuses exactly
 * like a candidate. Absence must never buy certification.
 */
export function readIdentityStatus(registry: unknown, identity: CursorIdentity): IdentityStatus {
  if (!isRecord(registry)) {
    return 'unknown';
  }
  const models = registry.models;
  if (!isRecord(models)) {
    return 'unknown';
  }
  const entry = models[identityKey(identity)];
  if (!isRecord(entry)) {
    return 'unknown';
  }
  const status = entry.status;
  if (status === 'certified' || status === 'candidate' || status === 'retired') {
    return status;
  }
  return 'unknown';
}

/**
 * Production unless the escape is set to its EXACT value. Every other value —
 * unset, empty, "0", "true", " 1" — is production, so a half-set or
 * misremembered escape never silently admits an uncertified identity.
 */
export function resolvePackPosture(env: NodeJS.ProcessEnv | Record<string, string | undefined>): PackPosture {
  return env[CURSOR_SEAT_SPIKE_ESCAPE_ENV] === CURSOR_SEAT_SPIKE_ESCAPE_VALUE ? 'spike' : 'production';
}

export interface AdmissionVerdict {
  admitted: boolean;
  reason: string;
}

export function admitCursorIdentity(opts: {
  identity: CursorIdentity;
  status: IdentityStatus;
  posture: PackPosture;
}): AdmissionVerdict {
  const key = identityKey(opts.identity);
  if (opts.status === 'certified') {
    return { admitted: true, reason: `${key} is certified in the model steward registry` };
  }
  if (opts.posture === 'spike') {
    return {
      admitted: true,
      reason:
        `${key} is not certified in the model steward registry (status: ${opts.status}); ` +
        `the spike-only escape ${CURSOR_SEAT_SPIKE_ESCAPE_ENV}=${CURSOR_SEAT_SPIKE_ESCAPE_VALUE} admits it for this spike run only`,
    };
  }
  return {
    admitted: false,
    reason:
      `${key} is not certified in the model steward registry (status: ${opts.status}), ` +
      `so it cannot staff a seat on a production pack. Certify it via the model steward, or set ` +
      `${CURSOR_SEAT_SPIKE_ESCAPE_ENV}=${CURSOR_SEAT_SPIKE_ESCAPE_VALUE} for a spike run.`,
  };
}

// ── worktree binding ──────────────────────────────────────────────────────

export function roleWorktreePath(repoRoot: string, role: string): string {
  return MASTER_RESIDENT_ROLES.has(role) ? repoRoot : path.join(repoRoot, '.worktrees', role);
}

// ── structured session signals ────────────────────────────────────────────

export type HelperName = 'ready_for_next' | 'swarm_handoff';

export type SessionSignal =
  | { kind: 'stop_reason'; value: 'completed' | 'refused' | 'error'; detail?: string }
  | { kind: 'tool_event'; tool: string; permission: 'granted' | 'denied'; detail?: string }
  | { kind: 'helper_exit'; helper: HelperName; exitCode: number; forwarded?: boolean; detail?: string };

export type SeatStep = 'forward_handoff' | 'continue_session' | 'await_wake' | 'abort';

export interface SeatDecision {
  step: SeatStep;
  /** The exact structured signal this step was taken from. */
  fromSignal: string;
  reason: string;
}

/**
 * The whole decision surface, and a PURE function of the signal — no deps, no
 * environment, no rendered text. Two signals that a pane scraper would render
 * identically ("completed" as a stop reason vs a denied tool named
 * "completed") decide differently here precisely because the structure, not
 * the words, is what is read.
 */
export function decideNextStep(signal: SessionSignal | { kind: string }): SeatDecision {
  if (signal && (signal as SessionSignal).kind === 'stop_reason') {
    const stop = signal as Extract<SessionSignal, { kind: 'stop_reason' }>;
    if (stop.value === 'completed') {
      return {
        step: 'forward_handoff',
        fromSignal: 'stop_reason:completed',
        reason: 'the session reported the stage work finished',
      };
    }
    return {
      step: 'abort',
      fromSignal: `stop_reason:${stop.value}`,
      reason: `the session stopped with reason "${stop.value}"${stop.detail ? `: ${stop.detail}` : ''}`,
    };
  }

  if (signal && (signal as SessionSignal).kind === 'tool_event') {
    const tool = signal as Extract<SessionSignal, { kind: 'tool_event' }>;
    if (tool.permission === 'granted') {
      return {
        step: 'continue_session',
        fromSignal: `tool_event:${tool.tool}:granted`,
        reason: `the session was granted "${tool.tool}"`,
      };
    }
    return {
      step: 'abort',
      fromSignal: `tool_event:${tool.tool}:denied`,
      reason: `the session was denied "${tool.tool}"; a human decides what happens next`,
    };
  }

  if (signal && (signal as SessionSignal).kind === 'helper_exit') {
    const helper = signal as Extract<SessionSignal, { kind: 'helper_exit' }>;
    const from = `helper_exit:${helper.helper}:${helper.exitCode}`;
    if (helper.exitCode !== 0) {
      return {
        step: 'abort',
        fromSignal: from,
        reason: `${helper.helper} exited ${helper.exitCode}`,
      };
    }
    if (helper.forwarded) {
      return {
        step: 'await_wake',
        fromSignal: from,
        reason: `${helper.helper} delivered the parcel; the seat waits for its next wake and never polls on its own`,
      };
    }
    return { step: 'continue_session', fromSignal: from, reason: `${helper.helper} exited 0` };
  }

  return {
    step: 'abort',
    fromSignal: `unrecognised:${signal && typeof signal.kind === 'string' ? signal.kind : 'none'}`,
    reason: 'unrecognised session signal; the driver refuses to guess a next step from it',
  };
}

// ── the handoff draft ─────────────────────────────────────────────────────

const COMMIT_PATTERN = /^[0-9a-f]{10}$/;
const PRIORITY_PATTERN = /^[0-9]{2}$/;

/**
 * Plain `field: value` header lines — Article 2.2. A JSON envelope is rejected
 * by the parser (every brace line reads as an unknown header), so this builds
 * text and never serialises an object.
 */
export function buildSeatHandoffDraft(opts: {
  to: string;
  priority: string;
  task: string;
  commit: string;
}): string {
  if (!opts.to.trim()) {
    throw new Error('handoff draft: "to" must name a role');
  }
  if (!opts.task.trim()) {
    throw new Error('handoff draft: "task" must carry the stable task name');
  }
  if (!PRIORITY_PATTERN.test(opts.priority)) {
    throw new Error(`handoff draft: "priority" must be two digits 00-99, got "${opts.priority}"`);
  }
  if (!COMMIT_PATTERN.test(opts.commit)) {
    throw new Error(`handoff draft: "commit" must be exactly 10 lowercase hex characters, got "${opts.commit}"`);
  }
  return [
    'type: git_handoff',
    `to: ${opts.to}`,
    `priority: ${opts.priority}`,
    `task: ${opts.task}`,
    `commit: ${opts.commit}`,
    '',
  ].join('\n');
}

// ── ready_for_next output ─────────────────────────────────────────────────

export interface ReadyForNextTask {
  status: 'task';
  file: string;
  from: string;
  type: string;
  priority: string;
  taskName?: string;
  payload: string;
}

export type ReadyForNextResult =
  | ReadyForNextTask
  | { status: 'no_task' }
  | { status: 'rotate_home'; homeRole?: string }
  | { status: 'draining' };

function headerValue(lines: string[], name: string): string | undefined {
  const prefix = `${name}: `;
  const line = lines.find((l) => l.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

export function parseReadyForNextOutput(stdout: string): ReadyForNextResult {
  const lines = stdout.split('\n');
  const first = (lines[0] ?? '').trim();
  if (first === 'NO_TASK') {
    return { status: 'no_task' };
  }
  if (first === 'ROTATE_HOME') {
    return { status: 'rotate_home', homeRole: headerValue(lines, 'HOME_ROLE') };
  }
  if (first === 'DRAINING') {
    return { status: 'draining' };
  }
  const file = headerValue(lines, 'TASK');
  if (file === undefined) {
    return { status: 'no_task' };
  }
  const payloadIndex = lines.indexOf('PAYLOAD:');
  return {
    status: 'task',
    file,
    from: headerValue(lines, 'FROM') ?? 'unknown',
    type: headerValue(lines, 'TYPE') ?? 'unknown',
    priority: headerValue(lines, 'PRIORITY') ?? '50',
    taskName: headerValue(lines, 'TASK_NAME'),
    payload: payloadIndex === -1 ? '' : lines.slice(payloadIndex + 1).join('\n'),
  };
}

// ── the transcript (an OUTPUT, never an input) ────────────────────────────

export function renderTranscript(opts: {
  role: string;
  identity: CursorIdentity;
  posture: PackPosture;
  stamp: string;
  lines: string[];
}): string {
  return [
    `# Cursor seat transcript — ${opts.role}`,
    '',
    `- identity: ${identityKey(opts.identity)}`,
    `- pack posture: ${opts.posture}`,
    `- stamp: ${opts.stamp}`,
    '',
    '## Session',
    '',
    ...opts.lines,
    '',
  ].join('\n');
}

// ── the seat run ──────────────────────────────────────────────────────────

export interface SeatSession {
  sessionId: string;
}

export interface SeatWork {
  task?: string;
  commit?: string;
}

export interface SeatTaskResult {
  signal: SessionSignal;
  transcript: string[];
  work?: SeatWork;
}

export interface HelperResult {
  exitCode: number;
  stdout: string;
}

/**
 * Every side effect the driver can perform. The set is deliberately this
 * small: it is the whole surface a reviewer has to check to believe invariant
 * 1, and the whole surface a property test has to record to prove it.
 */
export interface SeatDeps {
  readRegistry(): unknown;
  composePromptBundle(role: string): Promise<string>;
  openSession(opts: {
    role: string;
    cwd: string;
    promptBundle: string;
    identity: CursorIdentity;
  }): Promise<SeatSession>;
  sendTask(session: SeatSession, task: ReadyForNextTask): Promise<SeatTaskResult>;
  runHelper(name: HelperName, args: string[]): Promise<HelperResult>;
  writeFile(filePath: string, content: string): void;
  now(): string;
}

export interface SeatRunOptions {
  repoRoot: string;
  role: string;
  identity: CursorIdentity;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Handoff priority for the forward. Defaults to the pipeline's `50`. */
  priority?: string;
}

export type SeatOutcomeKind = 'forwarded' | 'no_task' | 'refused_uncertified' | 'aborted';

export interface SeatRunOutcome {
  outcome: SeatOutcomeKind;
  reason: string;
  role: string;
  posture: PackPosture;
  worktree?: string;
  forwardedTo?: string;
  transcriptPath?: string;
  decisions: SeatDecision[];
  readyForNextCalls: number;
}

function transcriptPathFor(repoRoot: string, role: string, stamp: string): string {
  return path.join(repoRoot, '.swarmforge', 'cursor-seat', `${role}-${stamp}.transcript.md`);
}

/**
 * One wake, one parcel. The seat NEVER loops here: an empty mailbox reports
 * `no_task` after exactly one helper call and returns, because a role that
 * re-polls its own mailbox is the NO_TASK spin handoffd halts the swarm for.
 */
export async function runSeatOnce(deps: SeatDeps, opts: SeatRunOptions): Promise<SeatRunOutcome> {
  const decisions: SeatDecision[] = [];
  const posture = resolvePackPosture(opts.env);
  const status = readIdentityStatus(deps.readRegistry(), opts.identity);
  const admission = admitCursorIdentity({ identity: opts.identity, status, posture });

  // Invariant 3: refusal happens before ANY session, helper or write.
  if (!admission.admitted) {
    return {
      outcome: 'refused_uncertified',
      reason: admission.reason,
      role: opts.role,
      posture,
      decisions,
      readyForNextCalls: 0,
    };
  }

  const worktree = roleWorktreePath(opts.repoRoot, opts.role);
  const stamp = deps.now();
  const transcriptLines: string[] = [`driver: admitted — ${admission.reason}`];

  const finish = (outcome: SeatOutcomeKind, reason: string, extra: Partial<SeatRunOutcome> = {}): SeatRunOutcome => {
    transcriptLines.push(`driver: ${outcome} — ${reason}`);
    const transcriptPath = transcriptPathFor(opts.repoRoot, opts.role, stamp);
    deps.writeFile(
      transcriptPath,
      renderTranscript({ role: opts.role, identity: opts.identity, posture, stamp, lines: transcriptLines })
    );
    return {
      outcome,
      reason,
      role: opts.role,
      posture,
      worktree,
      transcriptPath,
      decisions,
      readyForNextCalls: 1,
      ...extra,
    };
  };

  const promptBundle = await deps.composePromptBundle(opts.role);
  const session = await deps.openSession({ role: opts.role, cwd: worktree, promptBundle, identity: opts.identity });

  const ready = await deps.runHelper('ready_for_next', []);
  if (ready.exitCode !== 0) {
    const decision = decideNextStep({ kind: 'helper_exit', helper: 'ready_for_next', exitCode: ready.exitCode });
    decisions.push(decision);
    return finish('aborted', decision.reason);
  }
  const parsed = parseReadyForNextOutput(ready.stdout);
  if (parsed.status !== 'task') {
    // Report and stop. No second poll, ever — the wake is the only trigger.
    return {
      outcome: 'no_task',
      reason: `ready_for_next reported ${parsed.status}; the seat waits for its next wake and does not poll again`,
      role: opts.role,
      posture,
      worktree,
      decisions,
      readyForNextCalls: 1,
    };
  }

  const result = await deps.sendTask(session, parsed);
  transcriptLines.push(...result.transcript);
  const decision = decideNextStep(result.signal);
  decisions.push(decision);
  if (decision.step !== 'forward_handoff') {
    return finish('aborted', decision.reason);
  }

  const task = result.work?.task ?? parsed.taskName;
  const commit = result.work?.commit;
  if (!commit || !task) {
    return finish(
      'aborted',
      'the session reported the stage work finished but named no commit and task to forward; nothing was sent'
    );
  }

  const to = nextActiveRole([...PIPELINE_CHAIN], opts.role);
  if (!to) {
    return finish('aborted', `${opts.role} is the end of the forward chain; there is no next role to hand off to`);
  }

  const draftPath = path.join(worktree, 'tmp', 'handoff.txt');
  deps.writeFile(draftPath, buildSeatHandoffDraft({ to, priority: opts.priority ?? '50', task, commit }));
  const sent = await deps.runHelper('swarm_handoff', [draftPath]);
  const sentDecision = decideNextStep({
    kind: 'helper_exit',
    helper: 'swarm_handoff',
    exitCode: sent.exitCode,
    forwarded: sent.exitCode === 0,
  });
  decisions.push(sentDecision);
  if (sentDecision.step !== 'await_wake') {
    return finish('aborted', sentDecision.reason);
  }
  return finish('forwarded', `${task} forwarded to ${to} at ${commit}`, { forwardedTo: to });
}
