// BL-449: the human-provided epic-id -> Telegram-topic-id map for the three
// pre-existing epic topics (147/149/151) the human hand-created before this
// ticket existed. Unlike backlogTopicMapStore.ts's own map, the swarm never
// WRITES this file - it is an operator-authored input the one-time backfill
// tool (tools/backfill-epic-topic-icons.ts) reads, because those three
// topics were never created through decideEpicTopicAction's own
// create/reuse flow and so have no other live source for their topic ids.
import * as fs from 'fs';
import * as path from 'path';

export function epicTopicMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'epic-topic-map.json');
}

export function readEpicTopicMap(targetPath: string): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(epicTopicMapPath(targetPath), 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}
