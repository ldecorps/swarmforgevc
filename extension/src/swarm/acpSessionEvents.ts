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
// every branch is reachable from a string.

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
export function parseAcpLine(line: string): AcpEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Not JSON-RPC at all. The agent CLI is free to write plain text to
    // stderr/stdout; that is transcript material, not a protocol violation.
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;

  const sessionId = readSessionId(msg);

  // session/prompt's RESULT carries the stop reason - the fact this whole
  // ticket exists to consume.
  const result = msg.result as Record<string, unknown> | undefined;
  if (result && typeof result === 'object') {
    const stop = result.stopReason;
    if (typeof stop === 'string' && STOP_REASONS.has(stop)) {
      return { kind: 'turn_ended', stopReason: stop as AcpStopReason, sessionId };
    }
  }

  const method = typeof msg.method === 'string' ? msg.method : null;
  if (!method) return null;

  const params = (msg.params as Record<string, unknown> | undefined) ?? {};

  if (method === 'session/request_permission') {
    const id = msg.id;
    const tool = readToolName(params);
    if ((typeof id === 'string' || typeof id === 'number') && tool) {
      return { kind: 'permission_requested', requestId: id, tool, sessionId };
    }
    return null;
  }

  if (method === 'session/update') {
    const update = (params.update as Record<string, unknown> | undefined) ?? {};
    const type = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : null;

    if (type === 'tool_call' || type === 'tool_call_update') {
      const tool = readToolName(update) ?? readToolName(params);
      const status = readToolStatus(update);
      if (tool && status) {
        return { kind: 'tool_status', tool, status, sessionId };
      }
      return null;
    }

    const text = readText(update);
    if (text === null) return null;
    const role: 'agent' | 'user' | 'tool' =
      type === 'user_message_chunk' ? 'user' : type === 'tool_call_output' ? 'tool' : 'agent';
    return { kind: 'transcript', role, text, sessionId };
  }

  return null;
}

function readSessionId(msg: Record<string, unknown>): string | undefined {
  const params = msg.params as Record<string, unknown> | undefined;
  const fromParams = params && typeof params.sessionId === 'string' ? params.sessionId : undefined;
  const result = msg.result as Record<string, unknown> | undefined;
  const fromResult = result && typeof result.sessionId === 'string' ? result.sessionId : undefined;
  return fromParams ?? fromResult;
}

function readToolName(o: Record<string, unknown>): string | null {
  for (const key of ['toolName', 'title', 'kind', 'name']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const tc = o.toolCall as Record<string, unknown> | undefined;
  if (tc && typeof tc === 'object') return readToolName(tc);
  return null;
}

function readToolStatus(o: Record<string, unknown>): 'started' | 'completed' | 'failed' | null {
  const v = o.status;
  if (typeof v !== 'string') return null;
  if (v === 'in_progress' || v === 'pending' || v === 'started') return 'started';
  if (v === 'completed' || v === 'success') return 'completed';
  if (v === 'failed' || v === 'error') return 'failed';
  return null;
}

// ACP content blocks are {type:'text', text} or a plain string, and a chunk may
// carry either one or a list.
function readText(update: Record<string, unknown>): string | null {
  const content = update.content ?? update.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => (typeof c === 'string' ? c : readTextBlock(c as Record<string, unknown>)))
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    return parts.length ? parts.join('') : null;
  }
  if (content && typeof content === 'object') return readTextBlock(content as Record<string, unknown>);
  return null;
}

function readTextBlock(block: Record<string, unknown>): string | null {
  const t = block.text;
  return typeof t === 'string' ? t : null;
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
