// BL-819: stage-dwell instrument -> LeanLedgerEvent[] for one ticket.
import { mailboxDir } from '../swarm/swarmState';
import { LeanLedgerEvent } from '../quality/leanLedger';
import { readHandoffHeaderRecordsWithBatches } from './swarmMetrics';
import { deriveDwellRecords } from './stageDwell';
import { MinimalRoleEntry, definedData } from './leanLedgerComposeShared';

// Two ledger events per stage pass, not one: a stage-entry marker (at the
// dequeued_at moment, reconstructed as completedAtMs - processingMs since
// DwellRecord doesn't carry the raw dequeued timestamp itself - both are
// already-computed facts from the same shipped instrument, never a new
// one) and a stage-exit marker (at completed_at, carrying processingMs).
// The two are distinguished by data-key presence alone (exit carries
// processingMs, entry never does) - no extra field needed - so a ticket's
// dwell in the stage is derivable from the pair's `at` values alone, per
// the acceptance scenario's "those two entries" requirement.
export function composeStageTransitionEvents(roles: MinimalRoleEntry[], ticket: string): LeanLedgerEvent[] {
  const events: LeanLedgerEvent[] = [];
  for (const entry of roles) {
    const headers = readHandoffHeaderRecordsWithBatches(mailboxDir(entry, 'inbox', 'completed'));
    const { records } = deriveDwellRecords(headers, entry.role);
    for (const record of records) {
      if (record.ticketId !== ticket) {
        continue;
      }
      const entryAtMs = record.completedAtMs - record.processingMs;
      events.push({
        ticket,
        type: 'stage_transition',
        source: 'stage-dwell',
        at: new Date(entryAtMs).toISOString(),
        role: record.role,
        data: definedData({ queueWaitMs: record.queueWaitMs }),
      });
      events.push({
        ticket,
        type: 'stage_transition',
        source: 'stage-dwell',
        at: new Date(record.completedAtMs).toISOString(),
        role: record.role,
        data: definedData({ processingMs: record.processingMs }),
      });
    }
  }
  return events;
}
