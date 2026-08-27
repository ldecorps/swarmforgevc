# BL-325 QA bounce evidence — 2026-07-13

## Failing command
```
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-325-human-in-the-loop-closed.feature
```

## Commit hash
`4c8c94fed8` (documenter's forward; underlying implementation from coder commit `7f28d6e196`)

## First error excerpt
```
# Subtest: An answer in an item's topic goes to that item's gate, even when other gates are pending
not ok 4 - An answer in an item's topic goes to that item's gate, even when other gates are pending
  ---
  error: `Scenario "An answer in an item's topic goes to that item's gate, even when other gates
  are pending": no step handler matched "Given two different backlog items are each waiting on
  their own approval question"`
  code: 'ERR_TEST_FAILURE'
```
(The other 6 scenarios in this feature file pass cleanly on a fresh `npm run compile` — this
is not a stale-build artifact, and it is not a regression in the original 4 scope items.)

## Failure class
`behavior` — scope item 6 of the ticket ("THE ANSWER MUST BE DIRECTED BY THE TOPIC'S TICKET,
NOT BY COUNTING GATES") was never implemented, not merely untested.

## Expected vs observed
Expected: `bl-topic-approval-sweep!`'s consumer resolves WHICH gate to answer using the BL
topic's own `backlogId` (the ticket's required `roleTicket` reverse-mapping, mirroring BL-301's
`conciergeTick.ts:95` outbound use of the same map), so a reply typed into ticket A's own topic
always answers A's gate regardless of how many other gates are pending elsewhere.

Observed: `operator-decide.ts`'s `runApprove` (the function `bl-topic-approval-sweep!` shells
into via `operator-decide.js <backlogId> approve <text>`) uses `command.threadId` ONLY to
address the reply-outbox response — it never filters `pendingGates` by it. Gate selection is
still the unmodified, global, count-based `filterPendingGates(computeRoleGateStatesLive(...))`
+ `handleApprovalDecision`, i.e. BL-285's original SUP-thread selector, reused as-is — exactly
what the ticket's own scope item 6 explicitly says NOT to do ("must NOT reuse BL-285's
selectGateDecision as-is"). With 2+ gates pending anywhere in the roster, a reply typed into
ticket A's own topic gets "which gate do you mean?" instead of answering A's directly.

## Root cause (why this happened, not just what broke)
The specifier amended the ticket AND the feature file (commit `a21eea1` on `main`, "answer
must be directed by the topic's ticket, not by counting gates") — adding scenario
`human-in-the-loop-closed-07` and the scope-6 requirement — as a direct result of the
architect's review of an EARLIER build of this same ticket. That amendment landed on `main`,
but the coder/cleaner/architect/documenter chain that produced `4c8c94fed8` never merged
`main` to pick it up: their own feature file has only 6 scenarios, not 7, and their own
`operator-decide.ts` diff never touches `runApprove`'s gate-selection logic. The architect who
reviewed THIS build (commit `aa08382dd9`) independently rediscovered the exact same gap
(confirmed via QA's own memory of that review) but, not realizing a formal, mandatory spec
amendment with a named scenario already existed for it on `main`, filed only a `rule_proposal`
rather than treating it as an unmet acceptance criterion.

## What to fix
1. Merge `main` (picks up `a21eea1`'s scenario 07 and the amended ticket notes).
2. Implement ticket-directed gate selection in the BL-topic approve path: resolve the gate via
   the topic's own `backlogId` -> `roleTicket` reverse mapping (mirror BL-301's
   `conciergeTick.ts:95` forward use), not the global count-based `selectGateDecision`. Keep
   ask-which only as the genuine fallback (the topic's own ticket has no pending gate).
3. Wire scenario `human-in-the-loop-closed-07`'s step handlers in
   `specs/pipeline/steps/humanInTheLoopClosedSteps.js`.
4. The original 4 scope items (question snippet, event consumer, egress extension, relay
   reuse) are correct and verified working — do not rebuild them.
