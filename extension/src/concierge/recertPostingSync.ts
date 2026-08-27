// BL-450: the adapter-injected I/O half of the Recert topic's live posting -
// posts/edits a SINGLE Telegram message in place, change-gated on the
// rendered TEXT, the same "durable last-rendered marker" posture
// approvalsRosterSync.ts/pipelineBoardSync.ts already model. Unlike those
// two (which always render SOMETHING, even an empty-set placeholder), a
// recert-telegram-08 empty queue must post NOTHING at all - so this module
// short-circuits before ever calling into editInPlaceMessageSync when there
// is no scenario to show, rather than rendering a "nothing to review" text
// of its own.
import { RecertifiableScenario } from '../docs/recertification';
import { renderRecertPosting } from './recertPosting';
import { EditInPlaceMessageResult, EditInPlaceMessageState, syncEditInPlaceMessage } from './editInPlaceMessageSync';

export interface RecertPostingAdapters {
  ensureRecertTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean>;
}

export type RecertPostingState = EditInPlaceMessageState;
export type RecertPostingSyncResult = EditInPlaceMessageResult;

export async function syncRecertPosting(
  scenario: RecertifiableScenario | undefined,
  prevState: RecertPostingState | undefined,
  adapters: RecertPostingAdapters
): Promise<RecertPostingSyncResult> {
  if (!scenario) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' };
  }
  return syncEditInPlaceMessage(renderRecertPosting(scenario), prevState, {
    ensureTopic: adapters.ensureRecertTopic,
    postMessage: adapters.postMessage,
    editMessage: adapters.editMessage,
  });
}
