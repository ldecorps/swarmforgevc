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
// BL-407: also backfills the DURABILITY gap alone, for a record whose
// content needs no opener repair but was simply never git-committed (a
// transient commitScopedFile failure - see gitCommitScopedFile.ts's own
// retry, which fixes this for future closes - can still leave an
// already-written record stuck exactly like this until something repairs
// it). Content stays byte-identical; only the commit is attempted.
//
// Usage: repair-bl-topic-records.js <project-root>
import * as fs from 'fs';
import { topicsDir, recordPath, readRecord, commitTopicRecord, isRecordCommitted, reportCommitFailureToStderr, CommitFailureReporter } from '../concierge/blTopicStore';
import { readBacklogFolders } from '../panel/backlogReader';
import { recordMissingOpener, regeneratedOpenerText, withRestoredOpener } from '../concierge/topicRecordRepair';
import { atomicWrite } from '../util/atomicWrite';
import { runCliMain } from './swarm-metrics';

export interface RepairOutcome {
  backlogId: string;
  repaired: boolean;
  reason: 'missing-opener-repaired' | 'no-matching-done-ticket' | 'opener-already-present' | 'backfilled-commit';
}

export interface RepairResult {
  outcomes: RepairOutcome[];
}

// Shared by both the opener-repair and the commit-only-backfill paths below:
// each writes/regenerates a record then must commit it, reporting (never
// throwing) on a commit failure exactly the same way either time.
function commitOrReport(
  targetPath: string,
  filePath: string,
  backlogId: string,
  reportCommitFailure: CommitFailureReporter
): void {
  if (!commitTopicRecord(targetPath, filePath, backlogId)) {
    reportCommitFailure(backlogId, filePath);
  }
}

// BL-407: the durability-only backfill described in the file header above.
function backfillUncommittedRecord(
  targetPath: string,
  backlogId: string,
  reportCommitFailure: CommitFailureReporter
): RepairOutcome {
  if (isRecordCommitted(targetPath, backlogId)) {
    return { backlogId, repaired: false, reason: 'opener-already-present' };
  }
  commitOrReport(targetPath, recordPath(targetPath, backlogId), backlogId, reportCommitFailure);
  return { backlogId, repaired: false, reason: 'backfilled-commit' };
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
      outcomes.push(backfillUncommittedRecord(targetPath, backlogId, reportCommitFailure));
      continue;
    }
    const openerText = regeneratedOpenerText(ticket);
    const repaired = withRestoredOpener(record, openerText);
    const filePath = recordPath(targetPath, backlogId);
    atomicWrite(filePath, JSON.stringify(repaired));
    commitOrReport(targetPath, filePath, backlogId, reportCommitFailure);
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
