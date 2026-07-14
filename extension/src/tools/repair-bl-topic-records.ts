#!/usr/bin/env node
// BL-348: repairs the (rare) backlog/topics/*.json record that starts
// directly with its TaskCompleted summary and no TaskStarted opener before
// it - see topicRecordRepair.ts for detection/regeneration. A repaired
// record gains an opener and a completion, NOT a reconstructed full
// transcript: any inbound/outbound turns that happened in between the real
// opener and the completion are gone for good.
//
// Cross-references backlog/topics/*.json against readBacklogFolders(...).
// done, since a regenerated opener needs the ticket's own title/notes/
// firstAcceptanceStep, only available for tickets that finished. A topic
// record whose ticket is not in .done (still active, or has no backlog
// entry left at all) is left untouched - there is nothing to regenerate an
// opener FROM.
//
// Usage: repair-bl-topic-records.js <project-root>
import * as fs from 'fs';
import { topicsDir, recordPath, readRecord, commitTopicRecord, reportCommitFailureToStderr, CommitFailureReporter } from '../concierge/blTopicStore';
import { readBacklogFolders } from '../panel/backlogReader';
import { recordMissingOpener, regeneratedOpenerText, withRestoredOpener } from '../concierge/topicRecordRepair';
import { atomicWrite } from '../util/atomicWrite';
import { runCliMain } from './swarm-metrics';

export interface RepairOutcome {
  backlogId: string;
  repaired: boolean;
  reason: 'missing-opener-repaired' | 'no-matching-done-ticket' | 'opener-already-present';
}

export interface RepairResult {
  outcomes: RepairOutcome[];
}

export function repairBlTopicRecords(
  targetPath: string,
  reportCommitFailure: CommitFailureReporter = reportCommitFailureToStderr
): RepairResult {
  const dir = topicsDir(targetPath);
  const outcomes: RepairOutcome[] = [];
  if (!fs.existsSync(dir)) {
    return { outcomes };
  }
  const byId = new Map(readBacklogFolders(targetPath).done.map((item) => [item.id, item]));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const backlogId = file.replace(/\.json$/, '');
    const ticket = byId.get(backlogId);
    if (!ticket) {
      outcomes.push({ backlogId, repaired: false, reason: 'no-matching-done-ticket' });
      continue;
    }
    const record = readRecord(targetPath, backlogId);
    if (!recordMissingOpener(record, ticket.title)) {
      outcomes.push({ backlogId, repaired: false, reason: 'opener-already-present' });
      continue;
    }
    const openerText = regeneratedOpenerText(ticket);
    const repaired = withRestoredOpener(record, openerText);
    const filePath = recordPath(targetPath, backlogId);
    atomicWrite(filePath, JSON.stringify(repaired));
    const committed = commitTopicRecord(targetPath, filePath, backlogId);
    if (!committed) {
      reportCommitFailure(backlogId, filePath);
    }
    outcomes.push({ backlogId, repaired: true, reason: 'missing-opener-repaired' });
  }
  return { outcomes };
}

export async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) {
    process.stderr.write('Usage: repair-bl-topic-records.js <project-root>\n');
    process.exitCode = 1;
    return;
  }
  const result = repairBlTopicRecords(targetPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
