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

function extractMessageId(json: unknown): number | undefined {
  if (
    json &&
    typeof json === 'object' &&
    (json as Record<string, unknown>).result &&
    typeof (json as Record<string, unknown>).result === 'object'
  ) {
    const messageId = ((json as Record<string, unknown>).result as Record<string, unknown>).message_id;
    return typeof messageId === 'number' ? messageId : undefined;
  }
  return undefined;
}

// replyToMessageId set links this message into an existing reply chain -
// BL-239's "one Telegram thread per run" is built from these chains: the
// first message about a run has no reply target, every later message about
// that same run replies to that first message's id.
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
  postFn: TelegramPostFn = defaultPost
): Promise<SendMessageResult> {
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    ...(replyToMessageId !== undefined ? { reply_to_message_id: replyToMessageId } : {}),
  });

  try {
    const res = await postFn(apiUrl(token, 'sendMessage'), body);
    if (!res.ok) {
      const description = extractDescription(res.json);
      return { success: false, error: redactToken(`Telegram API responded with status ${res.status}${description ? `: ${description}` : ''}`, token) };
    }
    return { success: true, messageId: extractMessageId(res.json) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    return { success: false, error: redactToken(`Telegram request failed: ${detail}`, token) };
  }
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
  try {
    const res = await postFn(apiUrl(token, 'getUpdates'), body);
    if (!res.ok) {
      const description = extractDescription(res.json);
      return { success: false, updates: [], error: redactToken(`Telegram API responded with status ${res.status}${description ? `: ${description}` : ''}`, token) };
    }
    const result =
      res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>).result : undefined;
    return { success: true, updates: Array.isArray(result) ? (result as TelegramUpdate[]) : [] };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    return { success: false, updates: [], error: redactToken(`Telegram request failed: ${detail}`, token) };
  }
}
