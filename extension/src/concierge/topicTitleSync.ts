// BL-414: the adapter-injected I/O half of the topic-title age suffix -
// reads a ticket's last-activity time, calls the pure decideTitleAge, and
// applies the edit only when the bucket actually changed. Mirrors
// topicIconSync.ts's own split (a small, named adapters interface; a pure
// decision function; a thin apply step).
import { StalenessBucket, decideTitleAge } from './topicTitleAge';

export interface TopicTitleAdapters {
  readLastActivityMs: (ticketId: string) => number | undefined;
  setTopicTitle: (topicId: number, title: string) => Promise<boolean>;
}

export type TitleSyncOutcome = 'updated' | 'skipped-no-activity' | 'skipped-unchanged-bucket' | 'failed';

export interface TitleSyncResult {
  // The bucket to persist as the topic's new lastAnnouncedBucket - stays
  // equal to prevBucket on any skip/failure, per the same "only a
  // SUCCESSFUL apply may advance persisted state" contract syncTopicIcon
  // and conciergeTick's own retry machinery already use.
  bucket: StalenessBucket | undefined;
  outcome: TitleSyncOutcome;
}

export async function syncTopicTitle(
  ticketId: string,
  topicId: number,
  rawTitle: string,
  nowMs: number,
  prevBucket: StalenessBucket | undefined,
  adapters: TopicTitleAdapters
): Promise<TitleSyncResult> {
  const lastUpdateMs = adapters.readLastActivityMs(ticketId);
  if (lastUpdateMs === undefined) {
    return { bucket: prevBucket, outcome: 'skipped-no-activity' };
  }
  const decision = decideTitleAge(rawTitle, lastUpdateMs, nowMs, prevBucket);
  if (decision.title === undefined) {
    return { bucket: decision.bucket, outcome: 'skipped-unchanged-bucket' };
  }
  const ok = await adapters.setTopicTitle(topicId, decision.title);
  if (!ok) {
    return { bucket: prevBucket, outcome: 'failed' };
  }
  return { bucket: decision.bucket, outcome: 'updated' };
}
