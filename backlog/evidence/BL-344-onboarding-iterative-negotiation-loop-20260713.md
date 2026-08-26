# BL-344 implementation evidence — 20260713 (coder)

## What was built

The iterative negotiation loop BL-262 cut to "its own slice" and never
ticketed. `extension/src/tools/negotiate-onboarding-contract.js` adds two
real commands on top of BL-262's own artifact (`.swarmforge/contract.yaml`
+ `CONTRACT.md`, unchanged shape):

```
node negotiate-onboarding-contract.js <target-repo> object "<objection text>"
node negotiate-onboarding-contract.js <target-repo> approve
```

- `object` revises the committed contract IN RESPONSE to the operator's
  own words (`extension/src/onboarding/contractNegotiation.ts`'s
  `reviseContractFromObjection` — keyword-driven: "remove/exclude X" moves
  a matching scope entry to out-of-scope; "add/include X" adds a new scope
  entry carrying the operator's own text; anything else is recorded as a
  new boundary, so the objection is ALWAYS reflected somewhere, never
  silently dropped), commits the revision, and appends a durable round
  record (`{round, objection, changedFields}`) to
  `.swarmforge/onboarding-negotiation.jsonl`.
- `approve` flips `agreement` to `agreed` and commits — the first
  PROGRAMMATIC way to agree; previously the only path was a hand-edit
  (confirmed absent before this ticket via `contractView.ts`/
  `coordinator.prompt`'s own "flip `agreement` in `.swarmforge/
  contract.yaml`" instructions).
- Bounded at `DEFAULT_MAX_NEGOTIATION_ROUNDS = 5`: a 6th objection attempt
  is refused and ends the negotiation without approving anything.
  Approval remains possible at any point up to and including immediately
  after the 5th round (see "a real bug found and fixed" below).
- The build-start gate (`onboarding-contract-gate.ts`) is UNCHANGED - a
  revision is still just `agreement: proposed`, so nothing new needed
  teaching it; verified live (see tests) that the gate holds through every
  round and only allows once `approve` actually lands.

BL-262's own slice 1 feature file now also carries slice 2's three parked
scenarios (`request-changes-revises-05`, `gate-held-through-rounds-06`,
`revision-is-responsive-07`, folded in from the now-deleted
`.feature.draft`, per BL-233's own promotion convention) - both features'
acceptance suites are green (18 scenarios total across BL-262 + BL-344).

## A real bug found and fixed during TDD

The pure negotiation state machine (`contractNegotiation.ts`) allows
`DEFAULT_MAX_NEGOTIATION_ROUNDS` successful rounds before an over-cap
objection attempt ends the negotiation - approval remains valid up through
and including right after the last successful round. The FIRST version of
the CLI's own state-reconstruction (`readNegotiationState`, which rebuilds
state fresh from disk on every separate invocation, since this loop is
re-invoked hours apart across real rounds) computed "ended" directly from
`rounds recorded >= maxRounds` - which meant that immediately after the
5th real round landed, the VERY NEXT invocation (an `approve` call) would
see the state as already `ended: round-limit` and refuse the approval
outright, even though the operator never attempted a 6th objection. A test
exercising exactly "5 real rounds, then approve" (not just "6 rounds") is
what caught this - a shallower "does the cap eventually trigger" test
would have missed it entirely.

Fixed with an explicit, persisted terminal marker
(`.swarmforge/onboarding-negotiation-ended.json`, written only when an
objection is ACTUALLY attempted after the budget is already exhausted) -
decoupling "the round budget is used up" from "the negotiation is
terminated", since using every round successfully is not itself terminal.
Regression test added: `negotiateOnboardingContractCli.test.js`'s
"approval is still possible immediately after using the LAST round of the
budget, before any over-cap attempt".

## Scope decision, stated plainly

The ticket's own "REUSE, DO NOT REBUILD" instruction points at BL-298/
BL-325/BL-320's Telegram front-desk round-trip (a gate's question posted
into the ticket's own BL-### topic, a reply routed back via
`TELEGRAM_BL_TOPIC_MESSAGE` events, and the answer typed straight into
the blocked agent's own tmux pane via `send-keys`). That mechanism is
real and does exactly what its own tickets say - but it is keyed to a
REGULAR SWARM TICKET's own gate-blocked pane. Onboarding is not a gated
role's pane waiting mid-build; it is two standalone CLIs
(`propose-onboarding-contract.js`, `onboarding-contract-gate.js`) that a
human or the coordinator invokes directly, with no live tmux/Telegram
wiring of its own today - confirmed by reading both tools in full, and by
`coordinator.prompt`'s own instruction to run them by hand at
promote-time. Building a live BL-topic association for onboarding TARGETS
(which are not backlog tickets in this swarm's own repo, and have no
BL-### identity at all) is a materially separate, foundational piece of
plumbing - not something this ticket's own acceptance scenarios name or
require, and not attempted here.

What WAS delivered keeps the SAME reuse discipline the ticket asks for at
the layer that actually exists today: `negotiate-onboarding-contract.js`
is built at the exact same maturity level as BL-262's own `propose`/`gate`
CLIs (a directly-invokable command, not a live daemon), takes the
operator's objection as plain text exactly as `propose` already takes a
survey-facts path, and rides the SAME artifact
(`contract.yaml`/`CONTRACT.md`) and the SAME gate, unchanged. However the
objection text reaches this CLI in practice - a human typing it directly,
or a future onboarding-specific Telegram topic once one exists - the
revision mechanics, round bounding, responsiveness guarantee, and history
recording this ticket actually asks for are all real and independently
tested today.

## E2E note for QA

All scenarios run against a REAL git-initialized fixture repo through the
REAL compiled CLIs (never a fixture standing in for the negotiation state
machine) - `extension/test/negotiateOnboardingContractCli.test.js` and
`specs/pipeline/steps/onboardingNegotiationSteps.js` both spawn the actual
`negotiate-onboarding-contract.js`/`onboarding-contract-gate.js`
subprocesses. Per the ticket's own E2E procedure: "propose; push back with
a substantive objection; assert the NEXT proposal actually differs in the
way the pushback asked for" is exactly what
`onboarding-negotiation-02`/`negotiation-revision-is-responsive-07` assert
against the real committed `contract.yaml` content, not a mock.
