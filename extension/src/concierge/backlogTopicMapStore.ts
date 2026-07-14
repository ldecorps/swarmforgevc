// The machine-local, gitignored backlogId->Telegram-thread-id map
// (BL-297/BL-298/BL-300/BL-331/BL-332): the reverse-keyed sibling of
// telegram-front-desk-bot.ts's own {topicId: subjectId} readTopicMap, one
// level of indirection topicRouter.ts's pure BacklogTopicMap policy reads
// and writes through via its adapters. Extracted from telegram-front-desk-
// bot.ts and recreate-bl-topic.ts, which had each accreted an identical
// path/read/write trio for this same file (jscpd-flagged clone, BL-332
// cleanup) - both now share this one IO adapter instead. Writes go through
// atomicWrite (temp-file + rename), the durable-write convention this file
// itself already used inconsistently in one of its two prior copies.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export function backlogTopicMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'backlog-topic-map.json');
}

export function readBacklogTopicMap(targetPath: string): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(backlogTopicMapPath(targetPath), 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

export function writeBacklogTopicMap(targetPath: string, topicMap: Record<string, number>): void {
  atomicWrite(backlogTopicMapPath(targetPath), JSON.stringify(topicMap));
}

// BL-331 scope item 5: removes a mapping once its topic is genuinely
// deleted, so nothing later posts into (or reverse-looks-up via
// backlogForTopic) a dead thread id.
export function dropBacklogTopicMapping(targetPath: string, backlogId: string): void {
  const map = readBacklogTopicMap(targetPath);
  delete map[backlogId];
  writeBacklogTopicMap(targetPath, map);
}
