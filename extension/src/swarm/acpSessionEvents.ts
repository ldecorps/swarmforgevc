// BL-1081: parsing ACP session traffic into structured facts.
//
// Pane text is the control channel for every seat today, and two expensive
// incident families exist only because of it: idleness is INFERRED from a
// frozen pane (defeated differently by a truncated tail, a ghost suggestion,
// and a `pane_current_command` that lies), and a permission moment arrives as
// an interactive menu that blocks the agent until a human notices.
//
// Agent Client Protocol makes both of those FACTS. `session/prompt` returns a
// stop reason; `session/request_permission` is a structured message. This file
// turns the wire into those facts and nothing else - no decisions, no I/O, so
// every branch is reachable from a string. Field-level wire variance (which
// key a tool name or a chunk's text arrives under) is owned by
// ./acpWireFields, so this file stays about MESSAGE shape, not FIELD shape.

import { readSessionId, readText, readToolName, readToolStatus } from './acpWireFields';

/** A stop reason as ACP spells it, plus the ones a host must survive. */
export type AcpStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'cancelled' | 'error';

export type AcpEvent =
  | { kind: 'turn_ended'; stopReason: AcpStopReason; sessionId?: string }
  | { kind: 'permission_requested'; requestId: string | number; tool: string; sessionId?: string }
  | { kind: 'transcript'; role: 'agent' | 'user' | 'tool'; text: string; sessionId?: string }
  | { kind: 'tool_status'; tool: string; status: 'started' | 'completed' | 'failed'; sessionId?: string };

const STOP_REASONS: ReadonlySet<string> = new Set([
  'end_turn',
  'max_tokens',
  'refusal',
  'cancelled',
  'error',
]);

/**
 * One line of ACP traffic -> zero or one fact.
 *
 * Returns null for anything this host does not model, which is most of the
 * protocol: a host that threw on an unrecognised message would take the seat
 * down the first time the CLI added a field, and the whole point is a control
 * channel more reliable than reading a pane.
 */
// Not JSON-RPC at all, or not an object. The agent CLI is free to write
// plain text to stderr/stdout; that is transcript material, not a protocol
// violation.
function parseMessage(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  return msg as Record<string, unknown>;
}

// session/prompt's RESULT carries the stop reason - the fact this whole
// ticket exists to consume.
function parseStopReason(msg: Record<string, unknown>): AcpEvent | null {
  const result = msg.result as Record<string, unknown> | undefined;
  if (!result || typeof result !== 'object') return null;
  const stop = result.stopReason;
  if (typeof stop === 'string' && STOP_REASONS.has(stop)) {
    return { kind: 'turn_ended', stopReason: stop as AcpStopReason, sessionId: readSessionId(msg) };
  }
  return null;
}

function parsePermissionRequest(
  msg: Record<string, unknown>,
  params: Record<string, unknown>,
  sessionId: string | undefined
): AcpEvent | null {
  const id = msg.id;
  const tool = readToolName(params);
  if ((typeof id === 'string' || typeof id === 'number') && tool) {
    return { kind: 'permission_requested', requestId: id, tool, sessionId };
  }
  return null;
}

function parseToolStatusUpdate(
  update: Record<string, unknown>,
  params: Record<string, unknown>,
  sessionId: string | undefined
): AcpEvent | null {
  const tool = readToolName(update) ?? readToolName(params);
  const status = readToolStatus(update);
  if (tool && status) {
    return { kind: 'tool_status', tool, status, sessionId };
  }
  return null;
}

function parseTranscriptUpdate(
  update: Record<string, unknown>,
  type: string | null,
  sessionId: string | undefined
): AcpEvent | null {
  const text = readText(update);
  if (text === null) return null;
  const role: 'agent' | 'user' | 'tool' =
    type === 'user_message_chunk' ? 'user' : type === 'tool_call_output' ? 'tool' : 'agent';
  return { kind: 'transcript', role, text, sessionId };
}

function parseSessionUpdate(
  params: Record<string, unknown>,
  sessionId: string | undefined
): AcpEvent | null {
  const update = (params.update as Record<string, unknown> | undefined) ?? {};
  const type = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : null;
  if (type === 'tool_call' || type === 'tool_call_update') {
    return parseToolStatusUpdate(update, params, sessionId);
  }
  return parseTranscriptUpdate(update, type, sessionId);
}

function parseByMethod(
  method: string,
  msg: Record<string, unknown>,
  sessionId: string | undefined
): AcpEvent | null {
  const params = (msg.params as Record<string, unknown> | undefined) ?? {};
  if (method === 'session/request_permission') {
    return parsePermissionRequest(msg, params, sessionId);
  }
  if (method === 'session/update') {
    return parseSessionUpdate(params, sessionId);
  }
  return null;
}

export function parseAcpLine(line: string): AcpEvent | null {
  const msg = parseMessage(line);
  if (!msg) return null;

  const stopEvent = parseStopReason(msg);
  if (stopEvent) return stopEvent;

  const method = typeof msg.method === 'string' ? msg.method : null;
  if (!method) return null;

  return parseByMethod(method, msg, readSessionId(msg));
}

/** Every fact in a stream of lines, in order. */
export function parseAcpStream(lines: readonly string[]): AcpEvent[] {
  const out: AcpEvent[] = [];
  for (const line of lines) {
    const e = parseAcpLine(line);
    if (e) out.push(e);
  }
  return out;
}
