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
  // BL-342: set only on a genuine 429 rate-limit response carrying
  // parameters.retry_after (Telegram's own told-you-so wait, in SECONDS) -
  // the Operator's own hand backfill hit exactly this ("Too Many Requests:
  // retry after 26") after 19 calls and silently dropped the remaining 7.
  // A caller that needs to honour it (editForumTopic's own bulk backfill)
  // reads this rather than treating a 429 as an ordinary opaque failure.
  retryAfterSeconds?: number;
}

// BL-342: split out of extractDescription's own shape guard (the SAME
// `json.parameters` envelope carries retry_after on a 429) rather than
// re-deriving the object-shape check a second time.
function extractRetryAfterSeconds(json: unknown): number | undefined {
  if (json && typeof json === 'object' && typeof (json as Record<string, unknown>).parameters === 'object') {
    const parameters = (json as Record<string, unknown>).parameters as Record<string, unknown>;
    return typeof parameters.retry_after === 'number' ? parameters.retry_after : undefined;
  }
  return undefined;
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
      return {
        success: false,
        error: redactToken(`Telegram API responded with status ${res.status}${description ? `: ${description}` : ''}`, token),
        retryAfterSeconds: extractRetryAfterSeconds(res.json),
      };
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

// BL-410: a row-of-rows of tappable buttons attached to a message via
// Telegram's reply_markup.inline_keyboard - callbackData rides back on the
// callback_query update a tap generates (Telegram's own wire field is
// callback_data; camelCased here to match this project's own naming, and
// translated at the one call site that builds the request body below).
export interface InlineKeyboardButton {
  text: string;
  callbackData: string;
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
// BL-410: buttons added LAST again (after messageThreadId), same
// existing-callers-unaffected posture - an ApprovalRequested message is the
// only caller that ever passes one.
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
  postFn: TelegramPostFn = defaultPost,
  messageThreadId?: number,
  buttons?: InlineKeyboardButton[][]
): Promise<SendMessageResult> {
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    ...(replyToMessageId !== undefined ? { reply_to_message_id: replyToMessageId } : {}),
    ...(messageThreadId !== undefined ? { message_thread_id: messageThreadId } : {}),
    ...(buttons
      ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.callbackData }))) } }
      : {}),
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

// BL-410: the update shape a tapped inline-keyboard button generates -
// distinct from an ordinary message update (mutually exclusive with
// `message` on a real TelegramUpdate). `data` carries the tapped button's
// own callback_data verbatim; `message` here is the ORIGINATING message the
// keyboard is attached to (its chat/topic), never the tap itself, which has
// no text of its own.
export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from?: { id: number | string };
  message?: { chat?: TelegramChat; message_thread_id?: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
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

// BL-410: clears a tapped inline-keyboard button's loading spinner. Must be
// called for every callback_query the bot recognizes as one of its own
// buttons, even a no-op (unknown/stale callback data) - Telegram's UI hangs
// on the tap otherwise. Mirrors closeForumTopic's own shape exactly (a
// single required id, no other body fields).
export interface AnswerCallbackQueryResult {
  success: boolean;
  error?: string;
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  postFn: TelegramPostFn = defaultPost
): Promise<AnswerCallbackQueryResult> {
  const body = JSON.stringify({ callback_query_id: callbackQueryId });
  const result = await callTelegramApi(token, 'answerCallbackQuery', body, postFn);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true };
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
// BL-342: iconCustomEmojiId added LAST (after postFn, so every existing
// positional call site keeps its exact prior behavior unchanged) - the
// topic's initial icon, resolved and validated by the caller against
// getForumTopicIconStickers below before ever reaching here.
export async function createForumTopic(
  token: string,
  chatId: string,
  name: string,
  postFn: TelegramPostFn = defaultPost,
  iconCustomEmojiId?: string
): Promise<CreateForumTopicResult> {
  const body = JSON.stringify({
    chat_id: chatId,
    name,
    ...(iconCustomEmojiId !== undefined ? { icon_custom_emoji_id: iconCustomEmojiId } : {}),
  });
  const result = await callTelegramApi(token, 'createForumTopic', body, postFn);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, messageThreadId: extractMessageThreadId(result.json) };
}

// BL-299: closes a forum topic (read-only, history preserved) - CLOSE, not
// delete (deleteForumTopic would destroy the very completion summary just
// posted into it). Mirrors createForumTopic's own shape/error handling.
export interface CloseForumTopicResult {
  success: boolean;
  error?: string;
}

export async function closeForumTopic(
  token: string,
  chatId: string,
  messageThreadId: number,
  postFn: TelegramPostFn = defaultPost
): Promise<CloseForumTopicResult> {
  const body = JSON.stringify({ chat_id: chatId, message_thread_id: messageThreadId });
  const result = await callTelegramApi(token, 'closeForumTopic', body, postFn);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true };
}

// BL-332: reopens a CLOSED (never deleted) forum topic - history and the
// original thread id are both intact, so this is the cheap, high-fidelity
// path topicRecreation.ts's decideTopicRestore prefers whenever the topic
// still exists at all; recreate+replay is the fallback only once it is
// genuinely gone (deleteForumTopic makes the thread id permanently
// unusable, which reopen cannot undo). Mirrors closeForumTopic's own
// shape exactly - the same request, the opposite direction.
export interface ReopenForumTopicResult {
  success: boolean;
  error?: string;
}

export async function reopenForumTopic(
  token: string,
  chatId: string,
  messageThreadId: number,
  postFn: TelegramPostFn = defaultPost
): Promise<ReopenForumTopicResult> {
  const body = JSON.stringify({ chat_id: chatId, message_thread_id: messageThreadId });
  const result = await callTelegramApi(token, 'reopenForumTopic', body, postFn);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true };
}

// BL-331: deletes a forum topic PERMANENTLY (destroys its history) - the
// verb closeForumTopic's own comment above deliberately avoided until a
// safe gate existed. This client function is a thin, unconditional
// wrapper, same posture as every other call in this file - the "only
// after a verified archive" safety lives in topicDeletion.ts's own
// decideTopicDeletion, never here.
export interface DeleteForumTopicResult {
  success: boolean;
  error?: string;
}

export async function deleteForumTopic(
  token: string,
  chatId: string,
  messageThreadId: number,
  postFn: TelegramPostFn = defaultPost
): Promise<DeleteForumTopicResult> {
  const body = JSON.stringify({ chat_id: chatId, message_thread_id: messageThreadId });
  const result = await callTelegramApi(token, 'deleteForumTopic', body, postFn);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true };
}

// BL-342: renames and/or re-icons an EXISTING forum topic - the wrapper the
// ticket's own intake assumed already existed (it does not; only
// createForumTopic/closeForumTopic were wrapped before this). Verified by
// the Operator to still succeed on a CLOSED topic, so a done ticket's icon
// can still be updated after its topic closes (BL-299's own close-on-
// completion is never a barrier here). retryAfterSeconds rides the shared
// TelegramApiCallResult (see callTelegramApi above) so a bulk backfill can
// honour a 429's own told-you-so wait instead of treating it as an
// ordinary opaque failure.
export interface EditForumTopicUpdate {
  name?: string;
  iconCustomEmojiId?: string;
}

export interface EditForumTopicResult {
  success: boolean;
  error?: string;
  retryAfterSeconds?: number;
}

export async function editForumTopic(
  token: string,
  chatId: string,
  messageThreadId: number,
  update: EditForumTopicUpdate,
  postFn: TelegramPostFn = defaultPost
): Promise<EditForumTopicResult> {
  const body = JSON.stringify({
    chat_id: chatId,
    message_thread_id: messageThreadId,
    ...(update.name !== undefined ? { name: update.name } : {}),
    ...(update.iconCustomEmojiId !== undefined ? { icon_custom_emoji_id: update.iconCustomEmojiId } : {}),
  });
  const result = await callTelegramApi(token, 'editForumTopic', body, postFn);
  if (!result.success) {
    return { success: false, error: result.error, retryAfterSeconds: result.retryAfterSeconds };
  }
  return { success: true };
}

function defaultWaitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// BL-414 hardener bounce: generalizes backfill-topic-icons.ts's own
// setTopicIconWithRateLimitRetry loop to ANY editForumTopic update (a name
// edit as much as an icon edit), so a caller that fires MANY edits in a
// tight loop - the one-time icon backfill, and now the live concierge
// tick's title-age sync on its own first-tick mass fan-out - can honour a
// 429's told-you-so retry_after instead of treating it as an ordinary,
// unrecoverable failure. Unbounded retry is deliberate here (mirrors the
// backfill's own precedent): the wait is a SERVER-TOLD, finite duration,
// never an open-ended guess, so retrying it forever cannot spin - the
// alternative (giving up) is exactly the "19 of 26 succeeded, 7 silently
// dropped" failure this exists to close. A genuine (non-429) failure
// returns false immediately, same as the backfill's own contract.
export async function editForumTopicWithRateLimitRetry(
  token: string,
  chatId: string,
  topicId: number,
  update: EditForumTopicUpdate,
  wait: (ms: number) => Promise<void> = defaultWaitMs,
  postFn: TelegramPostFn = defaultPost
): Promise<boolean> {
  for (;;) {
    const result = await editForumTopic(token, chatId, topicId, update, postFn);
    if (result.success) {
      return true;
    }
    if (result.retryAfterSeconds === undefined) {
      return false;
    }
    await wait(result.retryAfterSeconds * 1000);
  }
}

// BL-342: the ONLY valid source of a topic icon id - Telegram accepts icon
// ids ONLY from this set (112 today), never a hardcoded/guessed one (an
// unvalidated id fails at call time, on a live topic). Callers resolve a
// semantic icon (e.g. "which of these has the ✅ emoji") against this list,
// never construct or remember an id independently of it.
export interface ForumTopicIconSticker {
  emoji?: string;
  customEmojiId: string;
}

export interface GetForumTopicIconStickersResult {
  success: boolean;
  stickers: ForumTopicIconSticker[];
  error?: string;
}

function extractIconStickers(json: unknown): ForumTopicIconSticker[] {
  const result = json && typeof json === 'object' ? (json as Record<string, unknown>).result : undefined;
  if (!Array.isArray(result)) {
    return [];
  }
  return result.map((sticker) => ({
    emoji: typeof sticker?.emoji === 'string' ? sticker.emoji : undefined,
    customEmojiId: String(sticker?.custom_emoji_id ?? ''),
  }));
}

export async function getForumTopicIconStickers(
  token: string,
  postFn: TelegramPostFn = defaultPost
): Promise<GetForumTopicIconStickersResult> {
  const result = await callTelegramApi(token, 'getForumTopicIconStickers', JSON.stringify({}), postFn);
  if (!result.success) {
    return { success: false, stickers: [], error: result.error };
  }
  return { success: true, stickers: extractIconStickers(result.json) };
}
