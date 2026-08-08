// BL-819: reads the five instruments the ticket names ("reuse before
// invent") and maps each, for ONE ticket, into LeanLedgerEvent[] -
// leanLedgerStore.ts then appends whatever is new. Every function here is a
// READER over data some other, already-shipping piece of code wrote; none
// of them write anything.
//
// Each instrument's composer lives in its own module (split for mutation-
// site tractability - BL-485); this file is the public barrel plus the
// orchestrator that combines all five for one ticket.
import { MinimalRoleEntry } from './leanLedgerComposeShared';
import { LeanLedgerEvent } from '../quality/leanLedger';
import { composeStageTransitionEvents } from './leanLedgerComposeStageDwell';
import { composeBounceEvents } from './leanLedgerComposeBounce';
import { composeStageSkipEvents } from './leanLedgerComposeStageSkip';
import { composeStallEvents } from './leanLedgerComposeStall';
import { composeCloseEvent } from './leanLedgerComposeClose';

export type { MinimalRoleEntry };
export { composeStageTransitionEvents, composeBounceEvents, composeStageSkipEvents, composeStallEvents, composeCloseEvent };

export function composeAllLeanLedgerEvents(mainWorktreePath: string, roles: MinimalRoleEntry[], ticket: string): LeanLedgerEvent[] {
  const closeEvent = composeCloseEvent(mainWorktreePath, ticket);
  return [
    ...composeStageTransitionEvents(roles, ticket),
    ...composeBounceEvents(mainWorktreePath, ticket),
    ...composeStageSkipEvents(roles, ticket),
    ...composeStallEvents(mainWorktreePath, roles, ticket),
    ...(closeEvent ? [closeEvent] : []),
  ];
}
