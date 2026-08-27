// A pure inverse lookup over a {key: numeric id} map: given an id, which key
// (if any) maps to it. Shared by every such map in this project that needs
// to resolve an inbound Telegram topic id BACKWARDS to its owning key -
// topicRouter.ts's backlogForTopic (backlogId->topicId) and
// roleTopicMapStore.ts's roleForTopic (role->topicId) had each carried the
// exact same 4-line body (jscpd-flagged clone), the same duplication class
// BL-332 already extracted backlogTopicMapStore.ts's path/read/write trio
// for. undefined id short-circuits to undefined (a DM/no-topic case never
// resolves to a key) so every caller keeps that guard for free.
export function keyForId(map: Record<string, number>, id: number | undefined): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  const found = Object.entries(map).find(([, value]) => value === id);
  return found ? found[0] : undefined;
}
