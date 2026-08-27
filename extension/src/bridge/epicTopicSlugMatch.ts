// BL-686: pure decision core for resolving epic membership by SLUG. Children
// declare their epic by the epic ticket's `epic:` slug field, never by the
// epic ticket's own `id:` - and slugs are NOT unique (two epic tickets can
// declare the same slug), so a slug alone is not a usable wire identity for
// a tile. The wire identity stays the epic ticket's id (always unique,
// already the tile's own data-id); this module resolves that id to the
// slug(s)/ids it actually matches. Paths in, answer out - no filesystem, no
// HTTP - same testable-core boundary as epicReorderSafety.ts and
// makeTopPrioritySafety.ts beside it.
//
// Both the read side (computeEpicTopics, called from computeEpicReorderState)
// and the write side (resolveTopicMembership, called from
// handleEpicReorderTopicMakeTopRoute) are built on the same epicIdsForSlug
// primitive, so they can never disagree about who is in an epic (invariant
// 2). `type: epic` rows are excluded from both topics and peers (invariant
// 3) - an epic tracker self-declares its own slug and would otherwise appear
// as a topic (and a make-top peer) of itself. filterEpicsWithTopics is the
// tile/move subset of that same tagging: an epic with no live child is not
// a reorder neighbour.

export interface EpicTicket {
  id: string;
  epic?: string;
}

export interface LiveTicket {
  id: string;
  epic?: string;
  type?: string;
}

// Every epic ticket id whose OWN slug equals `slug` - zero, one, or more
// (duplicate slugs are real data, not an error condition here).
export function epicIdsForSlug(epics: EpicTicket[], slug: string | undefined): string[] {
  if (!slug) {
    return [];
  }
  return epics.filter((epic) => epic.epic === slug).map((epic) => epic.id);
}

// Every live, non-epic item that declares a slug, each tagged with every
// epic ticket id whose own slug matches it.
export function computeEpicTopics<T extends LiveTicket>(
  liveItems: T[],
  epics: EpicTicket[]
): Array<T & { epicIds: string[] }> {
  return liveItems
    .filter((item) => item.type !== 'epic' && item.epic)
    .map((item) => ({ ...item, epicIds: epicIdsForSlug(epics, item.epic) }));
}

// The reorder-tiles subset of `epics`: keep an epic only when at least one
// live child (paused/hold/active, never done, never another epic tracker)
// resolved to its ticket id. Childless trackers stay in backlog/paused/
// unchanged; they are just not reorder neighbours. Order is preserved, so
// this is a stable subset of the caller's already-sorted epic list. The
// read feed and the move route must share this so a hidden neighbour can
// never swallow a Move up / Move down tap.
export function filterEpicsWithTopics<T extends { id: string }>(
  epics: T[],
  topics: Array<{ epicIds: string[] }>
): T[] {
  const populated = new Set<string>();
  for (const topic of topics) {
    for (const id of topic.epicIds) {
      populated.add(id);
    }
  }
  return epics.filter((epic) => populated.has(epic.id));
}

// The topic-make-top route's target + peer set, resolved by the SAME
// slug-matching rule computeEpicTopics uses. Null when `epicId` does not
// name a live epic ticket, or `topicId` does not name a live non-epic
// ticket sharing that epic's slug.
export function resolveTopicMembership<T extends LiveTicket>(
  liveItems: T[],
  epics: EpicTicket[],
  epicId: string,
  topicId: string
): { target: T; peers: T[] } | null {
  const epicTicket = epics.find((epic) => epic.id === epicId);
  if (!epicTicket) {
    return null;
  }
  const target = liveItems.find((item) => item.id === topicId && item.type !== 'epic' && item.epic === epicTicket.epic);
  if (!target) {
    return null;
  }
  const peers = liveItems.filter(
    (item) => item.type !== 'epic' && item.epic === epicTicket.epic && item.id !== topicId
  );
  return { target, peers };
}
