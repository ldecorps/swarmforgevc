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
import { PipelineBoardData, renderPipelineBoard, renderPipelineBoardBody, renderPipelineBoardLinks } from './pipelineBoard';

export interface PipelineBoardAdapters {
  ensureBoardTopic: () => Promise<number | undefined>;
  // BL-465: linksHtml added LAST (after text) - the below-grid GitHub link
  // list, already rendered as its own HTML fragment (renderPipelineBoardLinks)
  // so the real adapter can append it AFTER the closing </pre> tag rather
  // than escaping it into the monospace block. Optional/empty for every
  // pre-BL-465 fixture that never passes a 3rd arg.
  postMessage: (topicId: number, text: string, linksHtml?: string) => Promise<number | undefined>;
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

// The topic id is created ONCE then reused - split out purely to keep
// syncPipelineBoard's own CRAP under threshold (mirrors
// editInPlaceMessageSync.ts's own resolveTopicId split).
function resolveBoardTopicId(prevState: PipelineBoardState | undefined, adapters: PipelineBoardAdapters): Promise<number | undefined> {
  return Promise.resolve(prevState?.topicId ?? adapters.ensureBoardTopic());
}

// BL-468: posts the fresh message FIRST, only deleting the prior one
// (best-effort) AFTER the new one already exists - so there is always at
// least one board message visible in the topic, and a failed post never
// leaves the old message already deleted. Split out purely to keep
// syncPipelineBoard's own CRAP under threshold.
async function postBoardMessage(
  topicId: number,
  text: string,
  linksHtml: string,
  contentSignature: string,
  lastChangeMs: number,
  prevState: PipelineBoardState | undefined,
  adapters: PipelineBoardAdapters
): Promise<PipelineBoardSyncResult> {
  const messageId = await adapters.postMessage(topicId, text, linksHtml);
  if (messageId === undefined) {
    // A failed post must never delete the still-good prior message - the
    // existing board (and its own tracked messageId) is left exactly as it
    // was, so a board is always visible even when the fresh post fails.
    return { state: { ...prevState, topicId }, outcome: 'failed-post' };
  }

  const hadPriorMessage = prevState?.messageId !== undefined;
  if (hadPriorMessage) {
    // Best-effort, only now that the new latest message already exists: an
    // already-gone or failed delete never blocks or undoes the post above -
    // see the adapters interface's own comment above.
    await adapters.deleteMessage(topicId, prevState!.messageId!);
  }

  return { state: { topicId, messageId, contentSignature, lastChangeMs }, outcome: hadPriorMessage ? 'reposted' : 'posted' };
}

export async function syncPipelineBoard(
  data: PipelineBoardData,
  prevState: PipelineBoardState | undefined,
  adapters: PipelineBoardAdapters,
  nowMs: number,
  repoBaseUrl?: string
): Promise<PipelineBoardSyncResult> {
  const contentSignature = renderPipelineBoardBody(data);
  if (contentSignature === prevState?.contentSignature) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' };
  }

  const topicId = await resolveBoardTopicId(prevState, adapters);
  if (topicId === undefined) {
    return { state: prevState ?? {}, outcome: 'failed-no-topic' };
  }

  const lastChangeMs = nowMs;
  const text = renderPipelineBoard(data, lastChangeMs);
  const linksHtml = renderPipelineBoardLinks(data.links ?? [], repoBaseUrl);
  return postBoardMessage(topicId, text, linksHtml, contentSignature, lastChangeMs, prevState, adapters);
}
