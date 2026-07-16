#!/usr/bin/env node
/**
 * BL-454: the one-time backfill - scans the git-tracked backlog/evidence/*.md
 * corpus and seeds the SAME durable .swarmforge/qa_bounces/<YYYY-MM>.jsonl log
 * record-qa-bounce.js appends to, so the metric has full history from day
 * one and not just from whenever the go-forward writer started running.
 *
 * For each evidence file: producing role + failure class come from the
 * file's own prose/filename (qaBounceEvidenceParser.ts); ticket type is
 * joined from the backlog YAML (BacklogItem.type via backlogReader.ts) -
 * never guessed from the evidence file itself. A file that isn't a genuine,
 * attributable bounce (no failure class found, no producing role found, or
 * its ticket's own backlog type is absent/outside the closed set) is
 * skipped, never recorded. Re-running this is a safe no-op: every record it
 * would produce already exists in the log (appendQaBounceRecordIfNew's own
 * idempotency), so nothing is double-counted.
 *
 * Usage: node backfill-qa-bounces.js
 */
import * as fs from 'fs';
import * as path from 'path';
import { readBacklogFolders } from '../panel/backlogReader';
import { isKnownTicketType, QaBounceRecord } from '../quality/qaBounce';
import { parseBounceEvidenceFile } from '../quality/qaBounceEvidenceParser';
import { appendQaBounceRecordIfNew } from '../quality/qaBounceStore';
import { printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

function evidenceDir(targetPath: string): string {
  return path.join(targetPath, 'backlog', 'evidence');
}

// Ticket id -> its backlog `type:` field, joined across every folder the
// pipeline can currently hold a ticket in - a bounced ticket is usually long
// done by the time the backfill runs, so `done/` must be searched too, not
// just `active/`.
export function buildTicketTypeIndex(targetPath: string): Map<string, string | undefined> {
  const folders = readBacklogFolders(targetPath);
  const index = new Map<string, string | undefined>();
  for (const item of [...folders.active, ...folders.paused, ...folders.done]) {
    if (!index.has(item.id)) {
      index.set(item.id, item.type);
    }
  }
  return index;
}

export interface BackfillQaBouncesResult {
  scanned: number;
  recorded: number;
  skipped: Array<{ file: string; reason: string }>;
}

export function backfillQaBounces(targetPath: string): BackfillQaBouncesResult {
  const dir = evidenceDir(targetPath);
  const ticketTypes = buildTicketTypeIndex(targetPath);
  const result: BackfillQaBouncesResult = { scanned: 0, recorded: 0, skipped: [] };

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return result;
  }

  for (const file of files.sort()) {
    result.scanned++;
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    const parsed = parseBounceEvidenceFile(file, content);
    if (!parsed) {
      result.skipped.push({ file, reason: 'not a genuine, attributable bounce record' });
      continue;
    }
    const ticketType = ticketTypes.get(parsed.ticket);
    if (!ticketType || !isKnownTicketType(ticketType)) {
      result.skipped.push({ file, reason: `ticket type for ${parsed.ticket} is unknown or not in the closed set` });
      continue;
    }
    const record: QaBounceRecord = { ...parsed, ticketType };
    if (appendQaBounceRecordIfNew(targetPath, record)) {
      result.recorded++;
    } else {
      result.skipped.push({ file, reason: 'already recorded (idempotent re-run)' });
    }
  }

  return result;
}

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  printJsonToStdout(backfillQaBounces(mainWorktreePath));
}

if (require.main === module) {
  runCliMain(main);
}
