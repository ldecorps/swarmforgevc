// BL-239: thin wrapper around the Telegram Bot API (sendMessage + getUpdates).
// Mirrors resendClient.ts's injectable-seam shape so tests never make a real
// network call and never need a real bot token. Unlike Resend (an
// Authorization header), Telegram's bot token is part of the URL path itself
// (https://api.telegram.org/bot<TOKEN>/<method>) - every helper that builds a
// URL from a token therefore also owns redacting that token out of any
// thrown/returned error text, the same non-behavioral guarantee
// sendResendEmail already gives its API key.
export interface TelegramPostResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export type TelegramPostFn = (url: string, body: string) => Promise<TelegramPostResponse>;

async function defaultPost(url: string, body: string): Promise<TelegramPostResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  return { ok: res.ok, status: res.status, json };
}

function redactToken(text: string, token: string): string {
  return token ? text.split(token).join('[redacted]') : text;
}

function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

interface TelegramApiCallResult {
  success: boolean;
  json?: unknown;
  error?: string;
}

// Shared by sendTelegramMessage/getTelegramUpdates/createForumTopic below -
// each POSTs a different method + body but interprets the response/error
// identically (a non-ok status becomes a description-carrying error, a
// thrown request becomes a redacted network-error message). Every caller
// still owns interpreting a SUCCESSFUL response's own json shape.
async function callTelegramApi(token: string, method: string, body: string, postFn: TelegramPostFn): Promise<TelegramApiCallResult> {
  try {
    const res = await postFn(apiUrl(token, method), body);
    if (!res.ok) {
      const description = extractDescription(res.json);
      return { success: false, error: redactToken(`Telegram API responded with status ${res.status}${description ? `: ${description}` : ''}`, token) };
    }
    return { success: true, json: res.json };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    return { success: false, error: redactToken(`Telegram request failed: ${detail}`, token) };
  }
}

export interface SendMessageResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

function extractDescription(json: unknown): string | undefined {
  if (json && typeof json === 'object' && typeof (json as Record<string, unknown>).description === 'string') {
    return (json as Record<string, unknown>).description as string;
  }
  return undefined;
}

// Shared by extractMessageId/extractMessageThreadId below - both pull a
// single numeric field off the same {result: {...}} envelope shape,
// differing only in which field.
function extractResultNumberField(json: unknown, field: string): number | undefined {
  if (
    json &&
    typeof json === 'object' &&
    (json as Record<string, unknown>).result &&
    typeof (json as Record<string, unknown>).result === 'object'
  ) {
    const value = ((json as Record<string, unknown>).result as Record<string, unknown>)[field];
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

function extractMessageId(json: unknown): number | undefined {
  return extractResultNumberField(json, 'message_id');
}

// replyToMessageId set links this message into an existing reply chain -
// BL-239's "one Telegram thread per run" is built from these chains: the
// first message about a run has no reply target, every later message about
// that same run replies to that first message's id.
//
// BL-281: messageThreadId (added LAST, after postFn, so every existing
// positional call site - which never passes a 6th arg - keeps its exact
// prior behavior unchanged) routes the message into a specific Telegram
// FORUM TOPIC (message_thread_id), the per-subject SUP-### hosting this
// ticket adds. Independent of replyToMessageId - a topic reply can also
// reply-chain within that topic.
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
  postFn: TelegramPostFn = defaultPost,
  messageThreadId?: number
): Promise<SendMessageResult> {
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    ...(replyToMessageId !== undefined ? { reply_to_message_id: replyToMessageId } : {}),
    ...(messageThreadId !== undefined ? { message_thread_id: messageThreadId } : {}),
  });

  const result = await callTelegramApi(token, 'sendMessage', body, postFn);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, messageId: extractMessageId(result.json) };
}

export interface TelegramChat {
  id: number | string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  reply_to_message?: { message_id: number };
  from?: { id: number | string; username?: string };
  // BL-281: present on a message posted inside a forum topic - the SAME id
  // sendTelegramMessage's messageThreadId routes a reply back into.
  message_thread_id?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface GetUpdatesResult {
  success: boolean;
  updates: TelegramUpdate[];
  error?: string;
}

function extractUpdates(json: unknown): TelegramUpdate[] {
  const result = json && typeof json === 'object' ? (json as Record<string, unknown>).result : undefined;
  return Array.isArray(result) ? (result as TelegramUpdate[]) : [];
}

// Long-polling read: `timeoutSeconds` is Telegram's own long-poll wait (the
// API holds the connection open until an update arrives or the timeout
// elapses), not a client-side request timeout.
export async function getTelegramUpdates(
  token: string,
  offset: number,
  timeoutSeconds: number,
  postFn: TelegramPostFn = defaultPost
): Promise<GetUpdatesResult> {
  const body = JSON.stringify({ offset, timeout: timeoutSeconds });
  const result = await callTelegramApi(token, 'getUpdates', body, postFn);
  if (!result.success) {
    return { success: false, updates: [], error: result.error };
  }
  return { success: true, updates: extractUpdates(result.json) };
}

// ── BL-281: forum-topic support ─────────────────────────────────────────

export interface CreateForumTopicResult {
  success: boolean;
  messageThreadId?: number;
  error?: string;
}

function extractMessageThreadId(json: unknown): number | undefined {
  return extractResultNumberField(json, 'message_thread_id');
}

// Creates a new forum topic in a supergroup with Topics enabled (a one-time
// human setup step, out of this ticket's scope to automate) - each SUP-###
// discussion gets its own topic so parallel subjects never bleed context
// (BL-281). The returned messageThreadId is the id every later
// sendTelegramMessage call for that subject routes into.
export async function createForumTopic(
  token: string,
  chatId: string,
  name: string,
  postFn: TelegramPostFn = defaultPost
): Promise<CreateForumTopicResult> {
  const body = JSON.stringify({ chat_id: chatId, name });
  const result = await callTelegramApi(token, 'createForumTopic', body, postFn);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, messageThreadId: extractMessageThreadId(result.json) };
}
