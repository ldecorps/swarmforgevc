// BL-1081: defensive field extraction from raw ACP wire JSON.
//
// The wire is untyped, and a given fact (a tool's name, a chunk's text) can
// arrive under any of a few keys or shapes depending on which ACP message
// carries it. These readers own that variance so the parsing layer in
// acpSessionEvents.ts can ask for a fact by name instead of re-deriving how
// to find it. Pure, no I/O, no decisions about what the fact MEANS.

export function readSessionId(msg: Record<string, unknown>): string | undefined {
  const params = msg.params as Record<string, unknown> | undefined;
  const fromParams = params && typeof params.sessionId === 'string' ? params.sessionId : undefined;
  const result = msg.result as Record<string, unknown> | undefined;
  const fromResult = result && typeof result.sessionId === 'string' ? result.sessionId : undefined;
  return fromParams ?? fromResult;
}

export function readToolName(o: Record<string, unknown>): string | null {
  for (const key of ['toolName', 'title', 'kind', 'name']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const tc = o.toolCall as Record<string, unknown> | undefined;
  if (tc && typeof tc === 'object') return readToolName(tc);
  return null;
}

const TOOL_STATUS_BY_WIRE_VALUE: Readonly<Record<string, 'started' | 'completed' | 'failed'>> = {
  in_progress: 'started',
  pending: 'started',
  started: 'started',
  completed: 'completed',
  success: 'completed',
  failed: 'failed',
  error: 'failed',
};

export function readToolStatus(o: Record<string, unknown>): 'started' | 'completed' | 'failed' | null {
  const v = o.status;
  if (typeof v !== 'string') return null;
  return TOOL_STATUS_BY_WIRE_VALUE[v] ?? null;
}

function readTextBlock(block: Record<string, unknown>): string | null {
  const t = block.text;
  return typeof t === 'string' ? t : null;
}

function readTextFromParts(content: unknown[]): string | null {
  const parts = content
    .map((c) => (typeof c === 'string' ? c : readTextBlock(c as Record<string, unknown>)))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  return parts.length ? parts.join('') : null;
}

// ACP content blocks are {type:'text', text} or a plain string, and a chunk may
// carry either one or a list.
export function readText(update: Record<string, unknown>): string | null {
  const content = update.content ?? update.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return readTextFromParts(content);
  if (content && typeof content === 'object') return readTextBlock(content as Record<string, unknown>);
  return null;
}
