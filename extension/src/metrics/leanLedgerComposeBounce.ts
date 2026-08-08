// BL-819: bounce-store instrument -> LeanLedgerEvent[] for one ticket.
//
// The ticket's own reuse list names bounce_count/bounce_history on the
// TICKET YAML (written by record-bounce.ts's updateTicketBounceHistory) as
// the instrument to compose from - not the gitignored qa_bounces/bounces
// JSONL aggregate (bounceStore.ts), which carries no evidence path at all.
// bounceHistory.ts's parseBounceHistoryEntries is that instrument's own
// reader, already shipping for BL-608's ticket-record display.
import * as fs from 'fs';
import { LeanLedgerEvent } from '../quality/leanLedger';
import { parseBounceHistoryEntries } from '../quality/bounceHistory';
import { definedData, findTicketYamlPath } from './leanLedgerComposeShared';

export function composeBounceEvents(targetPath: string, ticket: string): LeanLedgerEvent[] {
  const yamlPath = findTicketYamlPath(targetPath, ticket);
  if (!yamlPath) {
    return [];
  }
  let yamlText: string;
  try {
    yamlText = fs.readFileSync(yamlPath, 'utf8');
  } catch {
    return [];
  }
  return parseBounceHistoryEntries(yamlText).map((entry) => ({
    ticket,
    type: 'bounce',
    source: 'bounce-store',
    // The ticket record stores a date only (yyyy-mm-dd), never a full
    // timestamp - the day boundary IS the instrument's own recorded
    // precision, not a fabricated finer one.
    at: `${entry.at}T00:00:00.000Z`,
    data: definedData({ by: entry.by, blamedRole: entry.blamed, failureClass: entry.failureClass, commit: entry.commit, evidence: entry.evidence }),
  }));
}
