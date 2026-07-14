// BL-348: a small number of real backlog/topics/*.json records were found
// to start directly with their TaskCompleted summary and no TaskStarted
// opener before it - the opener was never recorded (a pre-BL-329 gap, or a
// dropped commit before BL-348's own CommitFailureReporter existed to
// surface that). A repaired record gains an opener and a completion, NOT a
// reconstructed full transcript - any inbound/outbound turns that happened
// in between are gone for good; this restores the HEADER, not the history.
import { TopicRecord, TopicMessage } from './blTopicStore';
import { topicNameForItem, messageTextForEvent } from './topicRouter';
import { SwarmEvent } from '../events/swarmEventStream';

export interface RepairTicket {
  id: string;
  title: string;
  notes?: string;
  firstAcceptanceStep?: string;
}

export function isCompletionText(text: string, backlogId: string, title: string): boolean {
  return text === `${topicNameForItem(backlogId, title)} is complete.`;
}

// A record is missing its opener when the very first message it carries IS
// the completion summary - the exact shape found in the two real offenders
// (BL-329, BL-330): seq 0 is already "... is complete.", so nothing was
// ever recorded before it. A record with any other first message (an
// opener, or an ordinary inbound/outbound turn) is left alone.
export function recordMissingOpener(record: TopicRecord, title: string): boolean {
  const first = record.messages[0];
  return first !== undefined && isCompletionText(first.text, record.id, title);
}

// Reuses topicRouter.ts's own messageTextForEvent - the ONE place opener
// text is composed/truncated - via a synthetic TaskStarted event, rather
// than re-deriving the "What it is / What it solves / How it works" format
// here. Keeps the repair tool's output byte-identical to what a live
// TaskStarted route would have posted for this ticket.
export function regeneratedOpenerText(ticket: RepairTicket): string {
  const event: SwarmEvent = {
    type: 'TaskStarted',
    backlogId: ticket.id,
    payload: {
      title: ticket.title,
      notes: ticket.notes,
      firstAcceptanceStep: ticket.firstAcceptanceStep,
    },
  };
  return messageTextForEvent(event);
}

// Inserts the regenerated opener before the existing (completion) message
// and renumbers seq - never mutates the input record. The opener's ts is
// stamped one millisecond before the completion it now precedes, so the
// record's own chronological order (already relied on elsewhere - see
// serialise-topic-03) stays correct without guessing at the real original
// timestamp, which is unrecoverable.
export function withRestoredOpener(record: TopicRecord, openerText: string): TopicRecord {
  const completion = record.messages[0];
  const opener: TopicMessage = {
    seq: 0,
    ts: completion.ts - 1,
    author: 'swarm',
    type: 'outbound',
    text: openerText,
  };
  const shifted = record.messages.map((m) => ({ ...m, seq: m.seq + 1 }));
  return { ...record, messages: [opener, ...shifted] };
}
