// BL-1081: ACP method/update message parsing.
//
// Owns session/request_permission and session/update shapes so
// acpSessionEvents.ts stays the thin line→fact orchestrator (JSON-RPC
// envelope + stop-reason result). Field-key variance stays in acpWireFields.

import type { AcpEvent } from './acpSessionTypes';
import { readText, readToolName, readToolStatus } from './acpWireFields';

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

function sessionUpdateType(update: Record<string, unknown>): string | null {
  return typeof update.sessionUpdate === 'string' ? update.sessionUpdate : null;
}

function malformedSessionUpdate(update: Record<string, unknown>, type: string | null): boolean {
  // Present-but-malformed sessionUpdate must not fall through as a transcript
  // with a default role — that collapses "absent type" and "unreadable type".
  return update.sessionUpdate != null && type === null;
}

function isToolStatusType(type: string | null): boolean {
  return type === 'tool_call' || type === 'tool_call_update';
}

function parseSessionUpdate(
  params: Record<string, unknown>,
  sessionId: string | undefined
): AcpEvent | null {
  const update = (params.update as Record<string, unknown> | undefined) ?? {};
  const type = sessionUpdateType(update);
  if (malformedSessionUpdate(update, type)) return null;
  if (isToolStatusType(type)) return parseToolStatusUpdate(update, params, sessionId);
  return parseTranscriptUpdate(update, type, sessionId);
}

/** Dispatch one JSON-RPC method notification into zero or one structured fact. */
export function parseAcpMethodEvent(
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
