// BL-450: pure render logic for the standing Recert topic's own posted
// message - the scenario currently oldest-unreviewed (conciergeTick.ts's
// own computeRecertBatch(1)-driven selection), rendered one at a time.
// Mirrors approvalsRoster.ts's own pure render/adapter split, with
// recertPostingSync.ts as the I/O half (edit-in-place, change-gated on this
// function's own rendered text).
import { RecertifiableScenario } from '../docs/recertification';

export function renderRecertPosting(scenario: RecertifiableScenario): string {
  return [
    `${scenario.id} — ${scenario.ticketTitle}`,
    '',
    scenario.text,
    '',
    `Reply "validate ${scenario.id}" to confirm it still holds, "amend ${scenario.id} <new text>" to propose a change, or "delete ${scenario.id}" to propose removing it.`,
  ].join('\n');
}
