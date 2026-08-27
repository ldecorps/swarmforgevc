#!/usr/bin/env node
// BL-329 scope item 5: import the human's past BL-topic messages, already
// captured in .swarmforge/operator/events.jsonl (TELEGRAM_BL_TOPIC_MESSAGE
// records, per telegram-front-desk-bot.ts's own postOperatorContext) but
// never durable - a fresh checkout loses them since .swarmforge/ is
// gitignored. Idempotent by CONTENT, not a persisted cursor: a cursor file
// would itself be gitignored runtime state, so losing it would re-import
// everything as duplicates - checking whether an identical
// {author, type, text} entry already exists in the ticket's own record
// survives a lost/absent cursor, and correctly no-ops on every event the
// LIVE wiring (postOperatorContext) already recorded going forward, so
// this is always safe to re-run.
//
// Usage: backfill-bl-topic-store.js <project-root>
import * as fs from 'fs';
import * as path from 'path';
import { appendMessage, readRecord, CommitFailureReporter, reportCommitFailureToStderr } from '../concierge/blTopicStore';
import { runCliMain } from './swarm-metrics';

interface BacklogTopicMessageEvent {
  backlogId: string;
  text: string;
}

function eventsLogPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'events.jsonl');
}

export function readBlTopicMessageEvents(targetPath: string): BacklogTopicMessageEvent[] {
  const file = eventsLogPath(targetPath);
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(
      (event): event is Record<string, unknown> & { backlogId: string; text: string } =>
        !!event && event.type === 'TELEGRAM_BL_TOPIC_MESSAGE' && typeof event.backlogId === 'string' && typeof event.text === 'string'
    );
}

export interface BackfillResult {
  imported: number;
  skipped: number;
}

export function backfillBlTopicStore(
  targetPath: string,
  reportCommitFailure: CommitFailureReporter = reportCommitFailureToStderr
): BackfillResult {
  const events = readBlTopicMessageEvents(targetPath);
  let imported = 0;
  let skipped = 0;
  for (const event of events) {
    const existing = readRecord(targetPath, event.backlogId);
    const alreadyPresent = existing.messages.some((m) => m.author === 'human' && m.type === 'inbound' && m.text === event.text);
    if (alreadyPresent) {
      skipped += 1;
      continue;
    }
    appendMessage(targetPath, event.backlogId, { author: 'human', type: 'inbound', text: event.text }, reportCommitFailure);
    imported += 1;
  }
  return { imported, skipped };
}

export async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) {
    process.stderr.write('Usage: backfill-bl-topic-store.js <project-root>\n');
    process.exitCode = 1;
    return;
  }
  const result = backfillBlTopicStore(targetPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
