// Edit-in-place busy/idle cue on Cursor Remote (no topic-icon churn —
// Telegram always posts a service message for icon edits).

import {
  syncEditInPlaceMessage,
  type EditInPlaceMessageResult,
  type EditInPlaceMessageState,
} from '../concierge/editInPlaceMessageSync';
import { editMessageText, sendTelegramMessage, type TelegramPostFn } from '../notify/telegramClient';
import type { CursorBridgePersistedState } from './telegramCursorBridgeCore';

export type CursorBridgeLivenessStatus = EditInPlaceMessageState;

/** One-line standing cue; change-gated so Telegram is not spammed. */
export function formatCursorBridgeLivenessLine(busy: boolean, queuedCount = 0): string {
  if (!busy) {
    // When idle with a queue, the selection poll is the actionable surface —
    // keep this line a simple idle cue rather than a second "N waiting" banner.
    return 'Bridge: idle';
  }
  return queuedCount > 0 ? `Bridge: busy · ${queuedCount} waiting` : 'Bridge: busy';
}

/**
 * BL-767: standing cue mirrored into the topic a queued question came from
 * (Cursor Remote already gets formatCursorBridgeLivenessLine's own line —
 * this is for every OTHER topic holding queued work). Always states its
 * count, even 0, so a drain is visible as "0 waiting" in that topic too.
 */
export function formatQueuedWorkLivenessLine(queuedCount: number): string {
  return queuedCount > 0 ? `Bridge: busy · ${queuedCount} waiting` : 'Bridge: idle · 0 waiting';
}

interface TelegramTransportDeps {
  botToken: string;
  chatId: string;
  postMessage?: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage?: (topicId: number, messageId: number, text: string) => Promise<boolean>;
  /** Telegram transport seam for the default postMessage/editMessage — never a real network call under test. */
  telegramPostFn?: TelegramPostFn;
}

export interface SyncLivenessStatusDeps extends TelegramTransportDeps {
  state: CursorBridgePersistedState;
  busy: boolean;
  persistState: () => void;
}

/** Default postMessage adapter — goes through the injectable Telegram transport seam, never a real network call under test. */
function defaultLivenessPostMessage(deps: TelegramTransportDeps): (topicId: number, text: string) => Promise<number | undefined> {
  return (id, body) =>
    sendTelegramMessage(deps.botToken, deps.chatId, body, undefined, deps.telegramPostFn, id).then((r) =>
      r.success ? r.messageId : undefined
    );
}

/** Default editMessage adapter — mirrors defaultLivenessPostMessage's transport seam. */
function defaultLivenessEditMessage(deps: TelegramTransportDeps): (topicId: number, messageId: number, text: string) => Promise<boolean> {
  return (id, messageId, body) =>
    editMessageText(deps.botToken, deps.chatId, messageId, body, undefined, deps.telegramPostFn).then((r) => r.success);
}

/** Persist the freshly-synced identity, or (a one-time backfill) an unchanged one that had no prior identity recorded. */
export function applyLivenessSyncResult(deps: SyncLivenessStatusDeps, result: EditInPlaceMessageResult): void {
  if (result.outcome === 'posted' || result.outcome === 'edited') {
    deps.state.livenessStatus = result.state;
    deps.persistState();
    return;
  }
  const isBackfill =
    result.outcome === 'skipped-unchanged' &&
    deps.state.livenessStatus === undefined &&
    result.state.messageId !== undefined;
  if (isBackfill) {
    deps.state.livenessStatus = result.state;
    deps.persistState();
  }
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
  const postMessage = deps.postMessage ?? defaultLivenessPostMessage(deps);
  const editMessage = deps.editMessage ?? defaultLivenessEditMessage(deps);

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
  applyLivenessSyncResult(deps, result);
}

export interface SyncQueuedWorkLivenessCuesDeps extends TelegramTransportDeps {
  state: CursorBridgePersistedState;
  persistState: () => void;
}

/**
 * BL-767 scope bullet 3 / approval_context bullet 1: mirror the busy cue
 * into every topic OTHER than Cursor Remote that currently holds (or, per
 * a drain, just stopped holding) queued work — so a question asked from
 * Bubble sees its own "N waiting" line update to "0 waiting" instead of
 * going quiet between ack and answer. Best-effort, same as
 * syncCursorBridgeLivenessStatus: a Telegram failure just leaves the prior
 * identity for a later retry.
 */
export async function syncQueuedWorkLivenessCues(deps: SyncQueuedWorkLivenessCuesDeps): Promise<void> {
  const cursorTopicId = deps.state.cursorTopicId;
  const counts = new Map<number, number>();
  for (const item of deps.state.pendingPrompts ?? []) {
    const topicId = item.originTopicId;
    if (topicId === undefined || topicId === cursorTopicId) {
      continue;
    }
    counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
  }
  const existing = deps.state.queuedWorkLivenessStatus ?? {};
  const topicIds = new Set<number>([...counts.keys(), ...Object.keys(existing).map(Number)]);
  if (topicIds.size === 0) {
    return;
  }

  const postMessage = deps.postMessage ?? defaultLivenessPostMessage(deps);
  const editMessage = deps.editMessage ?? defaultLivenessEditMessage(deps);
  const next: Record<string, EditInPlaceMessageState> = { ...existing };

  for (const topicId of topicIds) {
    const text = formatQueuedWorkLivenessLine(counts.get(topicId) ?? 0);
    const adapters = {
      ensureTopic: async () => topicId,
      postMessage,
      editMessage,
    };
    const prevState = existing[String(topicId)];
    let result = await syncEditInPlaceMessage(text, prevState, adapters);
    if (result.outcome === 'failed-edit') {
      result = await syncEditInPlaceMessage(text, { topicId }, adapters);
    }
    if (result.outcome === 'posted' || result.outcome === 'edited' || result.outcome === 'skipped-unchanged') {
      next[String(topicId)] = result.state;
    }
  }
  deps.state.queuedWorkLivenessStatus = next;
  deps.persistState();
}
