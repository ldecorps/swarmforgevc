// BL-819: backlog-close instrument -> LeanLedgerEvent for one ticket.
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { LeanLedgerEvent } from '../quality/leanLedger';
import { definedData, findTicketYamlPathUnder } from './leanLedgerComposeShared';

interface ParsedTopicMessage {
  ts: number;
  text: string;
}

// The swarm's own topic-router convention (topicOpeningSummary.ts family):
// a ticket's completion is announced as a message whose text starts with
// "<ticket> ✅ done". Read-only reuse of that already-written record for
// the close event's timestamp - never a freshly generated one. The LAST
// such message wins (a ticket can only close once in practice, but this
// stays correct if evidence ever shows more than one).
function readDoneMessageTimestamp(targetPath: string, ticket: string): number | null {
  let parsed: { messages?: ParsedTopicMessage[] };
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(targetPath, 'backlog', 'topics', `${ticket}.json`), 'utf8'));
  } catch {
    return null;
  }
  const doneMessages = (parsed.messages ?? []).filter((m) => typeof m.text === 'string' && m.text.startsWith(`${ticket} ✅`));
  if (doneMessages.length === 0) {
    return null;
  }
  return doneMessages[doneMessages.length - 1].ts;
}

// The commit that landed the ticket's YAML into backlog/done/ IS the QA-
// approved close commit (BL-247: QA is the integration point - the same
// commit that moves the file also lands the approved work). git's own
// history is the already-shipping record of that fact - no new producer,
// just a read - so this is the "backlog folder transition" instrument the
// ticket names, not a separate one. Degrades to absent (never a guess) when
// git has no add-commit for the path: no repo, an uncommitted fixture, or a
// worktree where `git log` genuinely can't find it.
function findAddingCommit(targetPath: string, yamlPath: string): string | undefined {
  try {
    const out = execFileSync('git', ['-C', targetPath, 'log', '--diff-filter=A', '--format=%H', '--', path.relative(targetPath, yamlPath)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const commits = out.split('\n').filter(Boolean);
    // Oldest add wins (git log lists newest-first) - the first time this
    // ticket's file landed in done/, in the unlikely case it was ever
    // removed and re-added.
    return commits.length > 0 ? commits[commits.length - 1] : undefined;
  } catch {
    return undefined;
  }
}

export function composeCloseEvent(targetPath: string, ticket: string): LeanLedgerEvent | null {
  const doneYamlPath = findTicketYamlPathUnder(path.join(targetPath, 'backlog', 'done'), ticket);
  if (!doneYamlPath) {
    return null;
  }
  const doneAtMs = readDoneMessageTimestamp(targetPath, ticket);
  if (doneAtMs === null) {
    return null;
  }
  return {
    ticket,
    type: 'close',
    source: 'backlog-close',
    at: new Date(doneAtMs).toISOString(),
    data: definedData({ folder: 'done', commit: findAddingCommit(targetPath, doneYamlPath) }),
  };
}
