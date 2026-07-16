// BL-452/BL-455: adapter-injected I/O half of the pipeline board. BL-462
// changed the mechanism: the board no longer edits a single message in
// place (that remains editInPlaceMessageSync.ts's job, still used verbatim
// by approvalsRosterSync.ts - DO NOT touch that shared module or point the
// roster at this one). The board now change-gates on a CONTENT SIGNATURE
// (the rendered grid + parked list, EXCLUDING the footer timestamp - see
// pipelineBoard.ts's renderPipelineBoardBody) and, on a real content change,
// DELETES the previously-posted message (if any) and POSTS a fresh one, so
// the board is always the LATEST message in its topic. An unchanged tick is
// a complete no-op: no delete, no post, no state change - the existing
// message (and its footer timestamp) stays exactly where it is.
import { PipelineBoardData, renderPipelineBoard, renderPipelineBoardBody } from './pipelineBoard';

export interface PipelineBoardAdapters {
  ensureBoardTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  // BL-462: replaces editMessage - the board never edits in place anymore.
  // Best-effort: its result is intentionally not branched on (see
  // syncPipelineBoard's own comment) - an orphaned undeleted old message is
  // a minor cosmetic issue, never a reason to fail posting the new latest
  // message.
  deleteMessage: (topicId: number, messageId: number) => Promise<boolean>;
}

export interface PipelineBoardState {
  topicId?: number;
  messageId?: number;
  // The last rendered BODY (grid + parked, no footer) - the change-gate
  // input. Distinct from the full posted text, which also carries the
  // footer stamped with lastChangeMs below.
  contentSignature?: string;
  // The instant the content signature last actually changed - fed into
  // renderPipelineBoard's footer. Never bumped on an unchanged tick, however
  // far the wall clock has moved (BL-462 pipeline-board-refine-06).
  lastChangeMs?: number;
}

export type PipelineBoardSyncOutcome = 'posted' | 'reposted' | 'skipped-unchanged' | 'failed-no-topic' | 'failed-post';

export interface PipelineBoardSyncResult {
  state: PipelineBoardState;
  outcome: PipelineBoardSyncOutcome;
}

export async function syncPipelineBoard(
  data: PipelineBoardData,
  prevState: PipelineBoardState | undefined,
  adapters: PipelineBoardAdapters,
  nowMs: number
): Promise<PipelineBoardSyncResult> {
  const contentSignature = renderPipelineBoardBody(data);
  if (contentSignature === prevState?.contentSignature) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' };
  }

  const lastChangeMs = nowMs;
  const text = renderPipelineBoard(data, lastChangeMs);
  const topicId = prevState?.topicId ?? (await adapters.ensureBoardTopic());
  if (topicId === undefined) {
    return { state: prevState ?? {}, outcome: 'failed-no-topic' };
  }

  const hadPriorMessage = prevState?.messageId !== undefined;
  if (hadPriorMessage) {
    // Best-effort: an already-gone or failed delete never blocks posting the
    // new latest message - see the adapters interface's own comment above.
    await adapters.deleteMessage(topicId, prevState!.messageId!);
  }

  const messageId = await adapters.postMessage(topicId, text);
  if (messageId === undefined) {
    return { state: { ...prevState, topicId }, outcome: 'failed-post' };
  }

  return { state: { topicId, messageId, contentSignature, lastChangeMs }, outcome: hadPriorMessage ? 'reposted' : 'posted' };
}
