// BL-1081: shared ACP fact types (no parsers). Kept free of imports so
// acpSessionEvents and acpSessionMethods can both depend inward without a
// cycle across the language/module boundary.

/** A stop reason as ACP spells it, plus the ones a host must survive. */
export type AcpStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'cancelled' | 'error';

export type AcpEvent =
  | { kind: 'turn_ended'; stopReason: AcpStopReason; sessionId?: string }
  | { kind: 'permission_requested'; requestId: string | number; tool: string; sessionId?: string }
  | { kind: 'transcript'; role: 'agent' | 'user' | 'tool'; text: string; sessionId?: string }
  | { kind: 'tool_status'; tool: string; status: 'started' | 'completed' | 'failed'; sessionId?: string };
