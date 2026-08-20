# BL-963 — severity re-triage (medium → high) and the missing acceptance scenario

- **Raised by**: architect, priority-00 note `20260820T093412Z_000291` to
  specifier + coordinator ("BL-963 D1 already on main (BL-957 landed) —
  re-triage severity"), evidence
  `backlog/evidence/BL-963-severity-stale-live-on-main-20260820.md`
  (commit `a0fee13f9`).
- **Decided by**: specifier, 2026-08-20, against `main` at `ee950e0bb9`.
- **Verdict**: severity **high**. Bookkeeping only for the coder's rebuild,
  plus ONE acceptance scenario the contract is missing (§4 below).

## 1. The architect's three factual claims — all re-probed, all CONFIRMED

| Claim | Probe | Result |
|---|---|---|
| BL-957 has landed | `backlog/done/M8/BL-957-promotion-gate-refuses-unsatisfied-depends-on.yaml` | CONFIRMED |
| D1's defective predicate is live on `main` | `main:swarmforge/scripts/chase_sweep_lib.bb:1018` — `(or (:ok verdict) (= "human_approval" (:gate verdict)))` | CONFIRMED |
| `evaluate` orders human_approval BEFORE depends_on | `main:swarmforge/scripts/promotion_gates_lib.bb:328-331` | CONFIRMED |

So a candidate refused by BOTH `human_approval` and `depends_on` reports the
single gate `human_approval` (first-failing-gate-wins), passes the filter, and
reaches all three consumers in `handoffd.bb`'s `open-slot-nudge-sweep!`
(`(count eligible)` for the fire decision, `top-open-slot-candidate` for
naming, `decide-open-slot-escalation` for SUP-1 accrual). The harm is BL-963's
own titled harm, live on `main` today.

## 2. What the medium rating was conditioned on — and why it is now false

BL-963's own rationale reads: *"no live misbehavior today, but the defect arms
the moment BL-957 lands."* BL-957 has landed AND the (partly defective)
consumer shipped with it. Both halves of the precondition for `medium` are
spent. Per the specifier severity rubric, a live fault degrading a safety /
health signal is `high`: the signal here is the SUP-1 supervisor escalation,
degraded in **both** directions —

- **false positive**: a doubly-refused ticket is named and accrues escalation,
  so the operator gets a "coordinator inaction" alert for a ticket no
  coordinator action could have promoted; and
- **false negative**: escalate-once then goes silent for that candidate, so
  the quiet afterwards reads as resolution (the coordinator's own BL-957
  evidence, `76cbd1067`), masking a later genuine stall.

## 3. What caps it BELOW critical — and what expediting does NOT buy

- **Blast radius is a notification, not a halt.** `send-open-slot-escalation-alert!`
  writes one Telegram OPERATOR line and one configured email. Nothing stops,
  kills, or throttles the swarm. No work is lost; no data is corrupted.
- **Zero live instances at this instant.** Measured across all **171**
  `backlog/paused/*.yaml`: **115** carry `human_approval: approved`, **56**
  carry no `human_approval:` field at all, and **0** carry a present
  non-approved value. A missing field is safe by construction —
  `human-approval-refusal` is `(when (and v (not= "approved" v)) ...)`, so an
  absent field yields no refusal and the candidate falls through to the
  `depends_on` gate correctly. The trigger shape therefore requires a
  *present* non-approved value.
- **But the shape is routine, not exotic.** The specifier mints new tickets
  with the literal `human_approval: pending`, and `depends_on` on unlanded
  work is ordinary. BL-963 itself was exactly this shape at mint
  (`depends_on: [BL-957]`, approval pending). Today's zero is timing, not
  containment.
- **Expediting buys nothing here.** Article 3.2.4 reorders **promotion**
  only. BL-963 is already in `backlog/active/`, already `assigned_to: coder`,
  already bounced to the coder for D1. Nothing in the pipeline moves faster
  because this field now reads `high`. The coordinator is not being asked to
  act on this re-triage; it is a record-accuracy correction so the ticket
  stops asserting a precondition that is false.

## 4. The spec gap this exposed — MINE, and it is one scenario

The architect's D1 correctly identifies that neither gate could have caught
the defect, and one of the two holes is in the acceptance contract I wrote:
scenario 02 is scoped to a ticket *"refused **solely** by the human_approval
gate"*, scenario 03 to *"every candidate refused for a reason **other than**
human_approval"*. The overlap — refused by human_approval AND another gate —
falls between them and is asserted nowhere, even though invariant 2's wording
(*"a candidate whose **only** refusal is human_approval"*) is correct as
written and already excludes it.

**Invariants are unchanged** — the architect confirmed both hold as worded;
invariant 2 is what D1 violates. The contract simply never gated its boundary.

### The missing scenario — verbatim text to add

Add to `specs/features/BL-963-open-slot-nudge-consults-promotion-gate-chain.feature`,
**in the same parcel as its step handler** (BL-233: the acceptance runner
throws on a scenario with no handler, so this text is deliberately NOT being
committed to the feature file on `main` ahead of the fix):

```gherkin
  # BL-963 nudge-consults-gate-chain-05
  Scenario: a candidate refused by human_approval AND another gate is filtered, not surfaced
    Given the top-ranked paused ticket is refused by the evaluate chain for both a pending human_approval and an unsatisfied depends_on
    And a lower-ranked paused ticket is allowed by the evaluate chain
    When the open-slot sweep decides its nudge
    Then a nudge fires naming the allowed ticket
    And the gate-refused ticket is not named
```

Three of its five steps are scenario 01's existing steps and reuse those
handlers unchanged; only the first `Given` is new. The final `Then` is
deliberately worded identically to scenario 01's so no near-duplicate step is
introduced (IR-DRY).

The property-runner hole the architect names (`gen-candidate`'s three kinds
are mutually exclusive, so the pending-AND-dep-blocked arm is never drawn) is
the coder's to close per the architect's remediation, with a coverage floor —
it is not an acceptance-contract change and needs nothing further from me.

## 5. Not in scope of this re-triage

- The architect's suggested `rule_proposal` — an architect reviewing ticket X
  in a shared batch commit should check whether the same commit carries a
  previously bounced, still-unresolved sibling's changes. The architect said
  they would file it separately; it is theirs to send, and it is still owed.
  Recorded here only so it is not lost.
- BL-963's scope, constraints, `qa_e2e_procedure`, and both invariants —
  untouched.
