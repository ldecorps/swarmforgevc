// BL-452: the adapter-injected I/O half of the pipeline board - renders the
// grid (pipelineBoard.ts, pure) and posts/edits a SINGLE Telegram message in
// place, change-gated on the rendered TEXT (never on a stage-transition
// diff), the same "durable last-rendered marker" posture standingIconSeenIds
// / titleAgeBuckets already model in conciergeTick.ts's own TickState.
// Mirrors topicTitleSync.ts's split (a small named adapters interface; a
// thin apply step) - the one, honest difference is a topic ID here is
// create-ONCE-then-reused (ensureBoardTopic is only ever called while no
// topicId is yet persisted), where a title/icon sync always targets an
// already-existing ticket topic.
import { PipelineBoardRow, renderPipelineBoard } from './pipelineBoard';

export interface PipelineBoardAdapters {
  ensureBoardTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean>;
}

export interface PipelineBoardState {
  topicId?: number;
  messageId?: number;
  renderedText?: string;
}

export type PipelineBoardSyncOutcome = 'posted' | 'edited' | 'skipped-unchanged' | 'failed-no-topic' | 'failed-post' | 'failed-edit';

export interface PipelineBoardSyncResult {
  // Only a SUCCESSFUL post/edit may advance renderedText/messageId - the
  // same "only a SUCCESSFUL apply may advance persisted state" contract
  // syncTopicTitle and conciergeTick's own retry machinery already keep, so
  // a failure is naturally retried against the same stale text next tick
  // rather than silently marked caught-up.
  state: PipelineBoardState;
  outcome: PipelineBoardSyncOutcome;
}

export async function syncPipelineBoard(
  rows: PipelineBoardRow[],
  prevState: PipelineBoardState | undefined,
  adapters: PipelineBoardAdapters
): Promise<PipelineBoardSyncResult> {
  const text = renderPipelineBoard(rows);
  if (text === prevState?.renderedText) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' };
  }

  const topicId = prevState?.topicId ?? (await adapters.ensureBoardTopic());
  if (topicId === undefined) {
    return { state: prevState ?? {}, outcome: 'failed-no-topic' };
  }

  if (prevState?.messageId === undefined) {
    const messageId = await adapters.postMessage(topicId, text);
    if (messageId === undefined) {
      return { state: { ...prevState, topicId }, outcome: 'failed-post' };
    }
    return { state: { topicId, messageId, renderedText: text }, outcome: 'posted' };
  }

  const ok = await adapters.editMessage(topicId, prevState.messageId, text);
  if (!ok) {
    return { state: prevState, outcome: 'failed-edit' };
  }
  return { state: { topicId, messageId: prevState.messageId, renderedText: text }, outcome: 'edited' };
}
