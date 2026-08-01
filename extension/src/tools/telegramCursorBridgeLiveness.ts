// Edit-in-place busy/idle cue on Cursor Remote (no topic-icon churn —
// Telegram always posts a service message for icon edits).

import { syncEditInPlaceMessage, type EditInPlaceMessageState } from '../concierge/editInPlaceMessageSync';
import { editMessageText, sendTelegramMessage, type TelegramPostFn } from '../notify/telegramClient';
import type { CursorBridgePersistedState } from './telegramCursorBridgeCore';

export type CursorBridgeLivenessStatus = EditInPlaceMessageState;

/** One-line standing cue; change-gated so Telegram is not spammed. */
export function formatCursorBridgeLivenessLine(busy: boolean, queuedCount = 0): string {
  if (!busy) {
    return queuedCount > 0 ? `Bridge: idle · ${queuedCount} waiting` : 'Bridge: idle';
  }
  return queuedCount > 0 ? `Bridge: busy · ${queuedCount} waiting` : 'Bridge: busy';
}

export interface SyncLivenessStatusDeps {
  botToken: string;
  chatId: string;
  state: CursorBridgePersistedState;
  busy: boolean;
  persistState: () => void;
  postMessage?: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage?: (topicId: number, messageId: number, text: string) => Promise<boolean>;
  /** Telegram transport seam for the default postMessage/editMessage — never a real network call under test. */
  telegramPostFn?: TelegramPostFn;
}

/**
 * Post or edit the standing liveness line on Cursor Remote.
 * Best-effort: Telegram failures leave the prior identity for a later retry.
 */
export async function syncCursorBridgeLivenessStatus(deps: SyncLivenessStatusDeps): Promise<void> {
  const topicId = deps.state.cursorTopicId;
  if (topicId === undefined) {
    return;
  }
  const queuedCount = deps.state.pendingPrompts?.length ?? 0;
  const text = formatCursorBridgeLivenessLine(deps.busy, queuedCount);
  const postMessage =
    deps.postMessage ??
    ((id, body) =>
      sendTelegramMessage(deps.botToken, deps.chatId, body, undefined, deps.telegramPostFn, id).then((r) =>
        r.success ? r.messageId : undefined
      ));
  const editMessage =
    deps.editMessage ??
    ((id, messageId, body) =>
      editMessageText(deps.botToken, deps.chatId, messageId, body, undefined, deps.telegramPostFn).then(
        (r) => r.success
      ));

  const adapters = {
    ensureTopic: async () => topicId,
    postMessage,
    editMessage,
  };

  let result = await syncEditInPlaceMessage(text, deps.state.livenessStatus, adapters);
  if (result.outcome === 'failed-edit') {
    // Message gone (manual delete / remint) — post a fresh line.
    result = await syncEditInPlaceMessage(text, { topicId }, adapters);
  }
  if (result.outcome === 'posted' || result.outcome === 'edited' || result.outcome === 'skipped-unchanged') {
    if (result.outcome !== 'skipped-unchanged') {
      deps.state.livenessStatus = result.state;
      deps.persistState();
    } else if (deps.state.livenessStatus === undefined && result.state.messageId !== undefined) {
      deps.state.livenessStatus = result.state;
      deps.persistState();
    }
  }
}
