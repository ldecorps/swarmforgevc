// BL-452: the adapter-injected I/O half of the pipeline board - renders the
// grid (pipelineBoard.ts, pure) and posts/edits a SINGLE Telegram message in
// place, change-gated on the rendered TEXT (never on a stage-transition
// diff), the same "durable last-rendered marker" posture standingIconSeenIds
// / titleAgeBuckets already model in conciergeTick.ts's own TickState.
// Mirrors topicTitleSync.ts's split (a small named adapters interface; a
// thin apply step) - the one, honest difference is a topic ID here is
// create-ONCE-then-reused (ensureBoardTopic is only ever called while no
// topicId is yet persisted), where a title/icon sync always targets an
// already-existing ticket topic. The create-once/post-or-edit control flow
// itself lives in editInPlaceMessageSync.ts, shared with
// approvalsRosterSync.ts (cleaner, BL-434 pass: the two were duplicating it
// byte-for-byte).
import { PipelineBoardData, renderPipelineBoard } from './pipelineBoard';
import { EditInPlaceMessageResult, EditInPlaceMessageState, syncEditInPlaceMessage } from './editInPlaceMessageSync';

export interface PipelineBoardAdapters {
  ensureBoardTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean>;
}

export type PipelineBoardState = EditInPlaceMessageState;
export type PipelineBoardSyncResult = EditInPlaceMessageResult;

export async function syncPipelineBoard(
  data: PipelineBoardData,
  prevState: PipelineBoardState | undefined,
  adapters: PipelineBoardAdapters
): Promise<PipelineBoardSyncResult> {
  const text = renderPipelineBoard(data);
  return syncEditInPlaceMessage(text, prevState, { ensureTopic: adapters.ensureBoardTopic, postMessage: adapters.postMessage, editMessage: adapters.editMessage });
}
