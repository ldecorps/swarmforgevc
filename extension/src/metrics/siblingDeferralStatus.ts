// BL-861: closes the lifecycle gap between a sibling deferral (BL-532) and
// the blocker it names. Nothing previously observed a blocker CLOSING - a
// released-in-fact sibling stayed deferred on paper until a human happened
// to ask. This module adds the single shared lookup (invariant: a ticket
// reported releasable by `status` is never reported blocked by `list`, and
// vice versa) that both the status and list CLI commands read from - and
// nothing else, so they can never diverge.
//
// Impure (reads backlog/ and .swarmforge/qa_deferrals/ off disk) - lives in
// metrics/ alongside siblingDeferralStore.ts for the same no-io-from-policy
// reason documented there.
import * as path from 'path';
import { readBacklogFolders } from '../panel/backlogReader';
import { OpenBlocker, openBlockersForTicket } from '../quality/siblingDeferral';
import { readSiblingDeferralRecords } from './siblingDeferralStore';

export interface BlockerClosure {
  closed: boolean;
  // Repo-relative path to the blocker's ticket file under backlog/done/,
  // present only when closed: true.
  closedAt?: string;
}

// The single shared lookup (BL-861 invariant 2): resolves whether a ticket
// id currently sits under backlog/done/ - the folder is authoritative
// (readBacklogFolders never gates on the YAML status: field, matching
// backlogReader.ts's own documented posture), so this can never disagree
// with what a human sees by listing the directory.
export function resolveBlockerClosure(targetPath: string, blockedBy: string): BlockerClosure {
  const folders = readBacklogFolders(targetPath);
  const needle = blockedBy.toUpperCase();
  const doneItem = folders.done.find((item) => item.id.toUpperCase() === needle);
  if (!doneItem) {
    return { closed: false };
  }
  const doneDir = doneItem.milestone ? path.join('backlog', 'done', doneItem.milestone) : path.join('backlog', 'done');
  return { closed: true, closedAt: path.join(doneDir, doneItem.filename ?? `${doneItem.id}.yaml`) };
}

export interface ClosedBlockerReport {
  blockedBy: string;
  closedAt: string;
}

export type DeferralStatusKind = 'verify' | 'releasable' | 'deferred';

export interface DeferralStatusReport {
  ticket: string;
  kind: DeferralStatusKind;
  // Populated only for kind 'deferred' - blockers whose ticket has not
  // closed, so the recorded check may legitimately still apply.
  openBlockers: OpenBlocker[];
  // Populated only for kind 'releasable' - blockers whose ticket HAS
  // closed; a closed blocker is never named as an open blocker (a
  // recorded check that reads its own active-backlog path would not
  // survive the close, so treating it as still-open would report an
  // unrunnable check as live).
  closedBlockers: ClosedBlockerReport[];
}

// The one place open-blocker records are reconciled against blocker
// closure - `status --ticket <T>` and `list` both call this and nothing
// else, so neither can drift from the other (BL-861 invariant 2).
export function computeTicketDeferralStatus(targetPath: string, ticket: string): DeferralStatusReport {
  const records = readSiblingDeferralRecords(targetPath);
  const recorded = openBlockersForTicket(records, ticket);
  if (recorded.length === 0) {
    return { ticket, kind: 'verify', openBlockers: [], closedBlockers: [] };
  }
  const openBlockers: OpenBlocker[] = [];
  const closedBlockers: ClosedBlockerReport[] = [];
  for (const blocker of recorded) {
    const closure = resolveBlockerClosure(targetPath, blocker.blockedBy);
    if (closure.closed) {
      closedBlockers.push({ blockedBy: blocker.blockedBy, closedAt: closure.closedAt as string });
    } else {
      openBlockers.push(blocker);
    }
  }
  const kind: DeferralStatusKind = openBlockers.length === 0 ? 'releasable' : 'deferred';
  return { ticket, kind, openBlockers, closedBlockers };
}

// Every ticket with at least one deferral record, reported releasable -
// i.e. stranded: released in fact (every recorded blocker has closed) but
// still deferred on paper because clearing stays QA's explicit act. A
// ticket still genuinely blocked by an open sibling is not stranded and is
// omitted here (it surfaces via `status` naming the real blocker instead).
export function listStrandedDeferrals(targetPath: string): DeferralStatusReport[] {
  const records = readSiblingDeferralRecords(targetPath);
  const tickets = [...new Set(records.map((record) => record.ticket))];
  return tickets
    .map((ticket) => computeTicketDeferralStatus(targetPath, ticket))
    .filter((report) => report.kind === 'releasable')
    .sort((a, b) => a.ticket.localeCompare(b.ticket));
}
