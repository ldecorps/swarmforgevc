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
// every branch is reachable from a string. Method/update shapes live in
// ./acpSessionMethods; field-level wire variance in ./acpWireFields.

import { parseAcpMethodEvent } from './acpSessionMethods';
import type { AcpEvent, AcpStopReason } from './acpSessionTypes';
import { readSessionId } from './acpWireFields';

export type { AcpEvent, AcpStopReason } from './acpSessionTypes';

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

export function parseAcpLine(line: string): AcpEvent | null {
  const msg = parseMessage(line);
  if (!msg) return null;

  const stopEvent = parseStopReason(msg);
  if (stopEvent) return stopEvent;

  const method = typeof msg.method === 'string' ? msg.method : null;
  if (!method) return null;

  return parseAcpMethodEvent(method, msg, readSessionId(msg));
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
