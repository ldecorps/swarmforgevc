// BL-1081 (QA bounce D1): the half that actually drives a seat.
//
// acpHostRuntime.ts renders what the agent says and records the facts it
// carries. Nothing, though, ever CONDUCTED a session - so no live seat ever
// produced a snapshot, `read-snapshot` returned nil for every real role, and
// invariant 1 ("seat control decisions consume structured session signals")
// held for nobody. That is the BL-149 shape: correct in isolation, invoked by
// nothing.
//
// This is the ACP client conversation, as a pure state machine. It takes the
// agent's lines and returns the lines to send back, so the entire protocol -
// handshake, session creation, prompting, permission answering - is testable
// without a process, a pipe, or a pane. The process wiring is
// tools/acp-host.ts, which owns the side effects and nothing else.
//
// Shapes verified live 2026-08-23 against `copilot --acp` and `gemini --acp`
// (both answer this exact `initialize` with protocolVersion 1). Mistral Vibe
// has NO ACP mode - see prompt_engine_lib.bb.

/** How the agent CLI names a choice on a permission request. */
export interface AcpPermissionOption {
  optionId: string;
  kind?: string;
  name?: string;
}

export interface AcpClientConfig {
  /** The seat's worktree. The agent's session is opened here, not in $PWD. */
  cwd: string;
  /** The role prompt bundle, delivered as the session's first prompt. */
  bootstrapPrompt?: string;
}

export type AcpClientPhase = 'initializing' | 'creating_session' | 'ready' | 'failed';

export interface AcpClientState {
  phase: AcpClientPhase;
  nextId: number;
  sessionId: string | null;
  /** Wakes that arrived before the session existed. Queued, never dropped. */
  pendingPrompts: string[];
  failure: string | null;
  /** Our own outstanding requests, by id, so a reply is matched to its ask. */
  inflight: Record<number, 'initialize' | 'session/new' | 'session/prompt'>;
}

export const ACP_PROTOCOL_VERSION = 1;

export function initialClientState(): AcpClientState {
  return {
    phase: 'initializing',
    nextId: 1,
    sessionId: null,
    pendingPrompts: [],
    failure: null,
    inflight: {},
  };
}

export function isReady(state: AcpClientState): boolean {
  return state.phase === 'ready' && state.sessionId !== null;
}

function encode(msg: unknown): string {
  return JSON.stringify(msg);
}

function request(
  state: AcpClientState,
  method: AcpClientState['inflight'][number],
  params: unknown
): { state: AcpClientState; line: string } {
  const id = state.nextId;
  return {
    state: { ...state, nextId: id + 1, inflight: { ...state.inflight, [id]: method } },
    line: encode({ jsonrpc: '2.0', id, method, params }),
  };
}

/** The first thing the host says. Nothing can happen before this is answered. */
export function openingRequests(
  state: AcpClientState,
  _config: AcpClientConfig
): { state: AcpClientState; out: string[] } {
  const { state: next, line } = request(state, 'initialize', {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  });
  return { state: next, out: [line] };
}

function promptRequest(
  state: AcpClientState,
  text: string
): { state: AcpClientState; line: string } {
  return request(state, 'session/prompt', {
    sessionId: state.sessionId,
    prompt: [{ type: 'text', text }],
  });
}

/**
 * Text typed into the pane, on its way to the agent as a structured prompt.
 *
 * The swarm wakes a `:chat-message` seat by typing at it, so this is the wake
 * path itself. A wake landing mid-handshake is QUEUED rather than discarded: a
 * dropped wake leaves the parcel in the mailbox with the seat looking healthy,
 * which is precisely the silent stall the structured channel exists to remove.
 */
export function onPaneInput(
  state: AcpClientState,
  text: string
): { state: AcpClientState; out: string[] } {
  if (state.phase === 'failed') return { state, out: [] };
  if (!isReady(state)) {
    return { state: { ...state, pendingPrompts: [...state.pendingPrompts, text] }, out: [] };
  }
  const { state: next, line } = promptRequest(state, text);
  return { state: next, out: [line] };
}

/**
 * Which choice unblocks the seat.
 *
 * `allow_always` is preferred over `allow_once` so one approval does not become
 * a permission moment on every subsequent call - an agent re-asking forever is
 * the menu block wearing a different hat. Returns null rather than inventing a
 * choice when the agent offers no allowing option at all; answering with a
 * rejection we were not offered would be the host deciding policy on its own.
 */
export function choosePermissionOption(
  options: readonly AcpPermissionOption[]
): AcpPermissionOption | null {
  const byKind = (kind: string) => options.find((o) => o && o.kind === kind && typeof o.optionId === 'string');
  return byKind('allow_always') ?? byKind('allow_once') ?? null;
}

function parse(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const msg: unknown = JSON.parse(trimmed);
    return msg && typeof msg === 'object' ? (msg as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function fail(state: AcpClientState, reason: string): { state: AcpClientState; out: string[] } {
  return { state: { ...state, phase: 'failed', failure: reason }, out: [] };
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === 'string') return m;
  }
  return JSON.stringify(err);
}

function drainPending(state: AcpClientState): { state: AcpClientState; out: string[] } {
  let next: AcpClientState = { ...state, pendingPrompts: [] };
  const out: string[] = [];
  for (const text of state.pendingPrompts) {
    const sent = promptRequest(next, text);
    next = sent.state;
    out.push(sent.line);
  }
  return { state: next, out };
}

function onInitializeResult(
  state: AcpClientState,
  config: AcpClientConfig
): { state: AcpClientState; out: string[] } {
  const { state: next, line } = request({ ...state, phase: 'creating_session' }, 'session/new', {
    cwd: config.cwd,
    mcpServers: [],
  });
  return { state: next, out: [line] };
}

function onSessionResult(
  state: AcpClientState,
  result: Record<string, unknown>,
  config: AcpClientConfig
): { state: AcpClientState; out: string[] } {
  const sessionId = result.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) {
    return fail(state, 'session/new returned no sessionId');
  }
  const ready: AcpClientState = { ...state, phase: 'ready', sessionId };
  const boot = config.bootstrapPrompt;
  const queued = boot ? { ...ready, pendingPrompts: [boot, ...ready.pendingPrompts] } : ready;
  return drainPending(queued);
}

function onPermissionRequest(
  state: AcpClientState,
  msg: Record<string, unknown>
): { state: AcpClientState; out: string[] } {
  const id = msg.id;
  if (typeof id !== 'string' && typeof id !== 'number') return { state, out: [] };
  const params = (msg.params as Record<string, unknown> | undefined) ?? {};
  const options = Array.isArray(params.options) ? (params.options as AcpPermissionOption[]) : [];
  const chosen = choosePermissionOption(options);
  const outcome = chosen
    ? { outcome: 'selected', optionId: chosen.optionId }
    : { outcome: 'cancelled' };
  return { state, out: [encode({ jsonrpc: '2.0', id, result: { outcome } })] };
}

/**
 * One line from the agent -> the lines the host owes it in reply.
 *
 * Anything that is not a reply to one of our own requests, and not a request
 * addressed to us, leaves the conversation untouched: transcript traffic is
 * acpHostRuntime's business, and a client that re-decided state on every chunk
 * would drift from what it actually asked for.
 */
export function onAgentMessage(
  state: AcpClientState,
  line: string,
  config: AcpClientConfig
): { state: AcpClientState; out: string[] } {
  if (state.phase === 'failed') return { state, out: [] };
  const msg = parse(line);
  if (!msg) return { state, out: [] };

  if (msg.method === 'session/request_permission') {
    return onPermissionRequest(state, msg);
  }

  const id = msg.id;
  if (typeof id !== 'number') return { state, out: [] };
  const asked = state.inflight[id];
  if (!asked) return { state, out: [] };

  const cleared: AcpClientState = { ...state, inflight: { ...state.inflight } };
  delete cleared.inflight[id];

  if (msg.error !== undefined) {
    return fail(cleared, `${asked} failed: ${errorText(msg.error)}`);
  }
  const result = (msg.result as Record<string, unknown> | undefined) ?? {};
  if (asked === 'initialize') return onInitializeResult(cleared, config);
  if (asked === 'session/new') return onSessionResult(cleared, result, config);
  // A prompt result is the end of a TURN, not of the session. The stop reason
  // it carries is read by acpHostRuntime/acpSeatState; the seat stays ready.
  return { state: cleared, out: [] };
}
