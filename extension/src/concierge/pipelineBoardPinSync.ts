// BL-467: enforces the pipeline board message as the ONLY pinned message in
// the Telegram group. Telegram pins are CHAT-level (one pin list per group),
// unlike the per-topic board content pipelineBoardSync.ts owns - this module
// only ever pins/unpins, never edits or deletes board content. Change-gated
// on the CURRENT top pinned message id vs the board's own message id (read
// fresh via getTopPinnedMessageId every call, never cached) so an already-
// clean tick - including one where a human unpinned nothing since the last
// enforcement - is a complete no-op: no unpin-all, no pin call. Best-effort
// like pipelineBoardSync.ts's own deleteMessage adapter: unpinAllMessages/
// pinMessage results are intentionally not branched on, so a failed call
// never throws and never aborts the tick.
//
// Durable lastPinnedBoardMessageId (carried on PipelineBoardState) covers
// the case where getChat().pinned_message does not reflect a board message
// living inside a forum topic - without it, every tick would unpin+re-pin
// and spam visible "pinned a message" service entries in the chat.
export interface PipelineBoardPinAdapters {
  getTopPinnedMessageId: () => Promise<number | undefined>;
  unpinAllMessages: () => Promise<boolean>;
  pinMessage: (messageId: number) => Promise<boolean>;
}

export type PipelineBoardPinSyncOutcome = 'skip-no-board' | 'skip-clean' | 'enforce';

export interface PipelineBoardPinSyncResult {
  outcome: PipelineBoardPinSyncOutcome;
  lastPinnedBoardMessageId?: number;
}

// Pure - no board message yet means nothing to pin (skip-no-board);
// the board already being the top pin means the group is already in the
// desired state (skip-clean); anything else (nothing pinned, or something
// else pinned - including a human's later hand-pin) must be enforced.
// lastPinnedBoardMessageId is the board message id this sync last
// successfully pinned - when getChat omits it but that id still matches
// the current board, treat the tick as clean (skip re-pin spam).
export function decidePipelineBoardPinAction(
  currentTopPinnedId: number | undefined,
  boardMessageId: number | undefined,
  lastPinnedBoardMessageId: number | undefined = undefined
): PipelineBoardPinSyncOutcome {
  if (boardMessageId === undefined) {
    return 'skip-no-board';
  }
  if (currentTopPinnedId === boardMessageId) {
    return 'skip-clean';
  }
  if (currentTopPinnedId !== undefined && currentTopPinnedId !== boardMessageId) {
    return 'enforce';
  }
  if (lastPinnedBoardMessageId === boardMessageId) {
    return 'skip-clean';
  }
  return 'enforce';
}

export async function syncPipelineBoardPin(
  boardMessageId: number | undefined,
  adapters: PipelineBoardPinAdapters,
  lastPinnedBoardMessageId: number | undefined = undefined
): Promise<PipelineBoardPinSyncResult> {
  const currentTopPinnedId = await adapters.getTopPinnedMessageId();
  const outcome = decidePipelineBoardPinAction(currentTopPinnedId, boardMessageId, lastPinnedBoardMessageId);
  if (outcome !== 'enforce') {
    return {
      outcome,
      lastPinnedBoardMessageId: boardMessageId ?? lastPinnedBoardMessageId,
    };
  }
  await adapters.unpinAllMessages();
  const pinned = await adapters.pinMessage(boardMessageId!);
  return {
    outcome,
    lastPinnedBoardMessageId: pinned ? boardMessageId : lastPinnedBoardMessageId,
  };
}
