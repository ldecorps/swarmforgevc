# BL-423: 8 Gherkin acceptance-mutation survivors are equivalent mutants (BL-234)

Hardener pass, 2026-07-17. Ran `run_gherkin_mutation.sh` (soft) against
`specs/features/BL-423-telegram-swarm-control-verbs.feature` (4
`Scenario Outline`s in this feature). Result: 8 mutations across 3
scenario outlines, 0 killed, 8 survived (exit 1). The 4th outline
("choosing a timed pause duration...", scenario index 12) mutated clean
(3/3 killed) in the same pass and its manifest entry is recorded normally.

Survivors, all mutating the `<verb>` Examples column (stop/restart/pause
case-swap mutants, e.g. `stop` -> `stOp`):

- scenario[2] "cancelling a control verb's confirmation leaves the swarm
  running" (2 examples: stop, restart) - 2/2 survived
- scenario[3] "an unauthorised sender's control verb is refused with no
  swarm action" (3 examples: stop, restart, pause) - 3/3 survived
- scenario[4] "a control verb outside the control topic is ignored with
  no swarm action" (3 examples: stop, restart, pause) - 3/3 survived

## Why these are equivalent, not a coverage gap (BL-234)

All three scenarios' `<verb>` value is provably never consulted on the
code path each scenario exercises, per `extension/src/tools/telegramControlCore.ts`:

- **Guard order is topic-then-principal-then-parse**
  (`decideControlEventAction`, lines 123-140): a wrong-topic event
  returns `{action:'ignore'}` before either the principal or the verb
  text is read; an unauthorised sender returns `{action:'refuse'}`
  before `decideControlTextAction(event.text)` is ever called. Both
  guards short-circuit strictly before the verb is parsed - the comment
  above the function calls this ordering "load-bearing" by design. So
  for scenario[3] (unauthorised sender) and scenario[4] (outside the
  control topic), mutating the verb string cannot change the outcome:
  the function returns before it would matter.
- **Cancel is verb-agnostic by construction**
  (`CONTROL_CALLBACK_HANDLERS.cancel`, line 89): `cancel: () =>
  ({action: 'cancel'})` takes no arguments at all - it does not receive
  `pendingConfirm`, so it cannot distinguish a pending stop-modes
  confirm from a pending restart-confirm. Scenario[2]'s premise ("a
  pending `<verb>` confirmation... cancel... swarm left running") holds
  identically for any pending-confirm kind, which is the correct
  behavior (a mis-tapped Cancel should never need to know what it's
  cancelling).

No assertion in the step handlers could differentiate the original
value from any of these mutants without asserting on implementation
trivia the ticket's own contract doesn't require. Per BL-234, recording
these 8 as equivalent rather than forcing an artificial assertion.

## Not forced into the manifest

The gherkin-mutator only persists a per-scenario manifest entry when
that scenario's own run has zero survivors and zero errors
(`aps.mutation/new-manifest`), so scenario[2]/[3]/[4] have no manifest
entry and will be re-mutated (and re-survive, harmlessly) on every
future `soft` run of this feature - this is the tool's own design, not
something this pass hand-edited. Do not treat a future re-appearance of
these exact 8 survivors as a new defect.

Unit suite (5052 tests), CRAP (max 5.08 on changed files, threshold 6),
and DRY (0 new clones touching this parcel's files) all pass clean; see
the hardener's git_handoff for the full pass.
