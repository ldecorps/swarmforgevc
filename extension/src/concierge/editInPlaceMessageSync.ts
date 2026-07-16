// Cleaner (BL-434 pass): the shared core `syncPipelineBoard` and
// `syncApprovalsRoster` were duplicating byte-for-byte - same state shape,
// same outcome set, same create-once-topic/post-or-edit-in-place control
// flow, differing only in the adapters' field NAMES and the caller's own
// render function. Both are "one durable message, edited in place,
// change-gated on rendered text" syncs; this module is that one mechanism,
// with each caller supplying its own render step and its own
// (differently-named) ensureTopic adapter.
export interface EditInPlaceMessageAdapters {
  ensureTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean>;
}

export interface EditInPlaceMessageState {
  topicId?: number;
  messageId?: number;
  renderedText?: string;
}

export type EditInPlaceMessageOutcome = 'posted' | 'edited' | 'skipped-unchanged' | 'failed-no-topic' | 'failed-post' | 'failed-edit';

export interface EditInPlaceMessageResult {
  // Only a SUCCESSFUL post/edit may advance renderedText/messageId - a
  // failure is naturally retried against the same stale text next tick
  // rather than silently marked caught-up.
  state: EditInPlaceMessageState;
  outcome: EditInPlaceMessageOutcome;
}

// The topic id is created ONCE then reused - split out purely to keep
// syncEditInPlaceMessage's own CRAP under threshold.
function resolveTopicId(prevState: EditInPlaceMessageState | undefined, adapters: EditInPlaceMessageAdapters): Promise<number | undefined> {
  return Promise.resolve(prevState?.topicId ?? adapters.ensureTopic());
}

async function postOrEditMessage(
  topicId: number,
  text: string,
  prevState: EditInPlaceMessageState | undefined,
  adapters: EditInPlaceMessageAdapters
): Promise<EditInPlaceMessageResult> {
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

export async function syncEditInPlaceMessage(
  text: string,
  prevState: EditInPlaceMessageState | undefined,
  adapters: EditInPlaceMessageAdapters
): Promise<EditInPlaceMessageResult> {
  if (text === prevState?.renderedText) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' };
  }

  const topicId = await resolveTopicId(prevState, adapters);
  if (topicId === undefined) {
    return { state: prevState ?? {}, outcome: 'failed-no-topic' };
  }

  return postOrEditMessage(topicId, text, prevState, adapters);
}
