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
export interface PipelineBoardPinAdapters {
  getTopPinnedMessageId: () => Promise<number | undefined>;
  unpinAllMessages: () => Promise<boolean>;
  pinMessage: (messageId: number) => Promise<boolean>;
}

export type PipelineBoardPinSyncOutcome = 'skip-no-board' | 'skip-clean' | 'enforce';

export interface PipelineBoardPinSyncResult {
  outcome: PipelineBoardPinSyncOutcome;
}

// Pure - no board message yet posted means nothing to pin (skip-no-board);
// the board already being the top pin means the group is already in the
// desired state (skip-clean); anything else (nothing pinned, or something
// else pinned - including a human's later hand-pin) must be enforced.
export function decidePipelineBoardPinAction(
  currentTopPinnedId: number | undefined,
  boardMessageId: number | undefined
): PipelineBoardPinSyncOutcome {
  if (boardMessageId === undefined) {
    return 'skip-no-board';
  }
  if (currentTopPinnedId === boardMessageId) {
    return 'skip-clean';
  }
  return 'enforce';
}

export async function syncPipelineBoardPin(
  boardMessageId: number | undefined,
  adapters: PipelineBoardPinAdapters
): Promise<PipelineBoardPinSyncResult> {
  const currentTopPinnedId = await adapters.getTopPinnedMessageId();
  const outcome = decidePipelineBoardPinAction(currentTopPinnedId, boardMessageId);
  if (outcome !== 'enforce') {
    return { outcome };
  }
  await adapters.unpinAllMessages();
  await adapters.pinMessage(boardMessageId!);
  return { outcome };
}
