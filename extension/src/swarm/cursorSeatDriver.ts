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
//  2. Every decision comes from a STRUCTURED session signal — see
//     `decideNextStep` in ./cursorSeatProtocol.
//
//  3. An identity that is not certified in the Model Steward registry cannot
//     be selected for a production pack — see ./cursorIdentity. Admission
//     runs FIRST, before the prompt bundle is composed or a session opened.
//
// This file is the orchestration layer only: it wires the identity
// certification module and the protocol module together into one seat run.
// (Split from a single 360-mutation-site file per the BL-485 advisory; the
// two halves below are re-exported so this stays the module's public
// surface.)

import * as path from 'path';
import { PIPELINE_CHAIN, nextActiveRole } from './rolePack';
import {
  admitCursorIdentity,
  readIdentityStatus,
  resolvePackPosture,
  roleWorktreePath,
  type CursorIdentity,
  type PackPosture,
} from './cursorIdentity';
import {
  buildSeatHandoffDraft,
  decideNextStep,
  parseReadyForNextOutput,
  renderTranscript,
  type HelperName,
  type ReadyForNextTask,
  type SeatDecision,
  type SessionSignal,
} from './cursorSeatProtocol';

export * from './cursorIdentity';
export * from './cursorSeatProtocol';

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
