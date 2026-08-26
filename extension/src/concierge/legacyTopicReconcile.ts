// BL-494: the migration slice that closes every LEGACY per-ticket Telegram
// topic now that BL-492/493's epic/Backlog edit-in-place routing has
// replaced the old per-ticket-topic model - backlog-topic-map.json still
// carries one entry per ticket from before that change, mixed together with
// epic-id entries (and any standing/reserved key, e.g. BACKLOG). This is
// the PURE "which map keys are legacy per-ticket topics" selection (the
// ticket's own thin-main rule); the impure close/drop I/O lives in
// close-legacy-ticket-topics.ts.

const PER_TICKET_KEY_PATTERN = /^BL-\d+$/;

// A POSITIVE allowlist, never a blanket "close everything minus a known
// exclusion list": the epic id namespace is explicitly separate from
// BL-### ticket ids (backlog-schema.md), and any reserved/standing key
// (e.g. a literal "BACKLOG" entry) is excluded by construction simply by
// not matching this shape - the tool never needs to enumerate every
// non-ticket key that might exist in the map, today or in the future.
export function isLegacyPerTicketTopicKey(key: string): boolean {
  return PER_TICKET_KEY_PATTERN.test(key);
}

export interface LegacyTopicEntry {
  backlogId: string;
  topicId: number;
}

export function selectLegacyPerTicketTopics(topicMap: Record<string, number>): LegacyTopicEntry[] {
  return Object.entries(topicMap)
    .filter(([key]) => isLegacyPerTicketTopicKey(key))
    .map(([backlogId, topicId]) => ({ backlogId, topicId }));
}
