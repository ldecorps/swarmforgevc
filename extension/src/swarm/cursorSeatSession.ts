// BL-713: the Cursor SDK session adapter for a role seat.
//
// Two halves, deliberately separated. The MAPPING half below is pure: SDK
// stream events and run results in, structured `SessionSignal`s out. It is
// where invariant 2 is actually enforceable — a signal is derived from an
// event's `type`/`status`/`name` fields and never from any text the agent
// rendered. Assistant prose, thinking text and status messages map to NO
// signal at all; they exist here only as transcript lines, which are written
// for a human and never read back.
//
// The LIVE half (createLiveCursorSeatSession) boots a real @cursor/sdk Agent
// bound to the seat's own worktree. It needs a CURSOR_API_KEY and a network,
// so nothing above it is allowed to depend on it.

import { execFileSync } from 'child_process';
import { Agent, type SDKAgent } from '@cursor/sdk';
import type {
  CursorIdentity,
  ReadyForNextTask,
  SeatSession,
  SeatTaskResult,
  SessionSignal,
} from './cursorSeatDriver';

// ── mapping (pure) ────────────────────────────────────────────────────────

/**
 * The run's terminal signal. Only the exact SDK status `completed` reads as a
 * completion; every other status — including one this adapter has never seen —
 * is an error, so a new SDK state can never be mistaken for finished work.
 */
export function signalFromRunResult(result: { status?: string; error?: { message?: string } }): SessionSignal {
  if (result && result.status === 'completed') {
    return { kind: 'stop_reason', value: 'completed' };
  }
  const detail = result?.error?.message ?? `unknown run status "${result?.status ?? 'none'}"`;
  return { kind: 'stop_reason', value: 'error', detail };
}

/**
 * A tool call's terminal state is the only stream event that is a decision
 * point. `running` is still in flight; assistant/thinking/status/task events
 * are prose and yield nothing.
 */
const TOOL_CALL_PERMISSIONS: Record<string, 'granted' | 'denied'> = { completed: 'granted', error: 'denied' };

export function signalFromStreamEvent(event: { type?: string; name?: string; status?: string }): SessionSignal | undefined {
  if (!event || event.type !== 'tool_call') {
    return undefined;
  }
  const permission = TOOL_CALL_PERMISSIONS[event.status ?? ''];
  if (!permission) {
    return undefined;
  }
  return { kind: 'tool_event', tool: event.name ?? 'unknown', permission };
}

function collapse(text: string, limit = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function assistantTranscriptLine(message: { content?: unknown[] } | undefined): string | undefined {
  const text = (message?.content ?? [])
    .map((part) => (typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
    .join(' ')
    .trim();
  return text ? `assistant: ${collapse(text)}` : undefined;
}

/** A human-readable line for the transcript artifact. Never an input. */
function toolCallTranscriptLine(event: { name?: string; status?: string }): string | undefined {
  if (!event.status) {
    return undefined;
  }
  return `tool ${event.name ?? 'unknown'}: ${event.status}`;
}

function thinkingTranscriptLine(text: string | undefined): string | undefined {
  if (!text?.trim()) {
    return undefined;
  }
  return `thinking: ${collapse(text)}`;
}

export function transcriptLineFromStreamEvent(event: {
  type?: string;
  name?: string;
  status?: string;
  text?: string;
  message?: { content?: unknown[] };
}): string | undefined {
  if (!event) {
    return undefined;
  }
  if (event.type === 'tool_call') {
    return toolCallTranscriptLine(event);
  }
  if (event.type === 'thinking') {
    return thinkingTranscriptLine(event.text);
  }
  if (event.type === 'assistant') {
    return assistantTranscriptLine(event.message);
  }
  return undefined;
}

/**
 * What the seat is asked to do with its parcel. Built here, not in the driver,
 * so the driver stays agnostic about how a particular agent runtime is
 * addressed.
 */
export function seatTaskPrompt(role: string, task: ReadyForNextTask): string {
  return [
    `You are the ${role} seat of this SwarmForge swarm. A parcel is already in_process for you.`,
    '',
    `Parcel file: ${task.file}`,
    `From: ${task.from}   Type: ${task.type}   Priority: ${task.priority}`,
    task.taskName ? `Task: ${task.taskName}` : '',
    '',
    'PAYLOAD:',
    task.payload,
    '',
    'Do your stage work in this worktree and commit it with your role byline.',
    'Do NOT send the handoff yourself and do NOT run ready_for_next.sh again —',
    'the seat driver forwards the parcel for you once you report finished.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ── live session (needs a real Cursor account) ────────────────────────────

export interface LiveCursorSeatSessionOptions {
  apiKey: string;
  modelId: string;
  /** Reads the seat worktree's HEAD as a 10-hex short sha, or undefined. */
  readHeadCommit?: (cwd: string) => string | undefined;
}

export function readHeadShortCommit(cwd: string): string | undefined {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    return /^[0-9a-f]{10}$/.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

export interface LiveSeatSession extends SeatSession {
  agent: SDKAgent;
  cwd: string;
}

export async function openLiveCursorSeatSession(
  opts: LiveCursorSeatSessionOptions & { cwd: string; promptBundle: string; identity: CursorIdentity }
): Promise<LiveSeatSession> {
  const agent = await Agent.create({
    apiKey: opts.apiKey,
    model: { id: opts.modelId },
    local: { cwd: opts.cwd, settingSources: [] },
  } as Parameters<typeof Agent.create>[0]);
  // The role's prompt bundle is the seat's identity: it is the FIRST thing the
  // session receives, before any parcel, exactly as a launched pane receives
  // it as its system prompt.
  const boot = await agent.send({ text: opts.promptBundle });
  for await (const _event of boot.stream()) {
    void _event;
  }
  await boot.wait();
  return { sessionId: agent.agentId, agent, cwd: opts.cwd };
}

async function consumeRunStream(
  stream: AsyncIterable<unknown>
): Promise<{ transcript: string[]; lastToolSignal: SessionSignal | undefined }> {
  const transcript: string[] = [];
  let lastToolSignal: SessionSignal | undefined;
  for await (const event of stream) {
    const line = transcriptLineFromStreamEvent(event as unknown as Parameters<typeof transcriptLineFromStreamEvent>[0]);
    if (line) {
      transcript.push(line);
    }
    const signal = signalFromStreamEvent(event as unknown as { type?: string; name?: string; status?: string });
    if (signal) {
      lastToolSignal = signal;
    }
  }
  return { transcript, lastToolSignal };
}

/**
 * A denied tool event is a decision point even when the run itself then
 * reports "completed": the seat must stop, not forward work a permission
 * gate blocked.
 */
function selectSignal(lastToolSignal: SessionSignal | undefined, stopSignal: SessionSignal): SessionSignal {
  return lastToolSignal && lastToolSignal.kind === 'tool_event' && lastToolSignal.permission === 'denied'
    ? lastToolSignal
    : stopSignal;
}

function resolveCommitWork(
  taskName: string | undefined,
  before: string | undefined,
  after: string | undefined
): SeatTaskResult['work'] {
  return { task: taskName, commit: after && after !== before ? after : undefined };
}

export async function sendTaskToLiveSession(
  session: LiveSeatSession,
  role: string,
  task: ReadyForNextTask,
  readHeadCommit: (cwd: string) => string | undefined = readHeadShortCommit
): Promise<SeatTaskResult> {
  const before = readHeadCommit(session.cwd);
  const run = await session.agent.send({ text: seatTaskPrompt(role, task) });
  const { transcript, lastToolSignal } = await consumeRunStream(run.stream());
  const result = await run.wait();
  const stopSignal = signalFromRunResult(result as { status?: string; error?: { message?: string } });
  const signal = selectSignal(lastToolSignal, stopSignal);
  const after = readHeadCommit(session.cwd);
  return { signal, transcript, work: resolveCommitWork(task.taskName, before, after) };
}
