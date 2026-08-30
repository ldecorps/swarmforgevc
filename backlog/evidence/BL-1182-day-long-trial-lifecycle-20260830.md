# BL-1182 — the day-long BoB trial lifecycle

Coder, 2026-08-30.

## What shipped

| piece | file |
|---|---|
| the lifecycle's pure decisions | `swarmforge/scripts/model_steward_trial_lib.bb` |
| trial state on disk | `read-trials!` / `write-trials!` in `model_steward_store.bb` |
| the operator surface | `model_steward_cli.bb trial nominate\|status\|assess` |
| the bb → node memory bridge | `extension/src/tools/trial-boundary-memory.ts` |
| example tests | `swarmforge/scripts/test/model_steward_trial_lib_test_runner.bb` |
| end-to-end CLI test | `swarmforge/scripts/test/test_model_steward_trial_cli.sh` |
| the three invariants | `swarmforge/scripts/test/bl1182_trial_lifecycle_property_runner.bb` |
| the bridge's own tests | `extension/test/trialBoundaryMemory.test.js` |
| acceptance handlers | `specs/pipeline/steps/bl1182DayLongBobTrialLifecycleSteps.js` |

Both new shell/bb test files carry a `standing` row in
`swarmforge/scripts/test/suite-manifest.tsv`; the inventory accepts them
(436 files, and the one remaining problem is BL-1276's, below).

## The design decision that only showed up by running it

`permanent-for-role` was written first as "the top certified recommendation for
the role", mirroring how BL-1181's cast picks a seat. That is wrong, and the
first end-to-end run said so immediately:

```
trial refused: cerebras/trial-model is already permanent for coder
```

If the permanent model is *defined* as the top-scoring one, then no candidate
can ever outrank it — the highest score IS the permanent by construction, and
every nomination that could teach us anything is refused. **The seat is what a
trial displaces, so the seat is what `permanent` has to mean.** The resolution
order is now: what the trial state recorded (a promotion or a revert writes it
there) → the role's current entry in ModelFactory's assignment overlay → and
only for a role that has never been seated at all, the top certified
recommendation as a bootstrap.

This is recorded at length in the function's own docstring, because the wrong
reading is the more natural one and the next reader will reach for it.

## Reused rather than re-stated

- **Cost comparison** is `model_factory_lib/cost-class-rank`, not a second
  table of the same three words. Invariant 1's tie-break and ModelFactory's
  cheap mode have to agree; two tables would eventually disagree and only one
  of them would be the one anybody tested.
- **The certification gate** is `model_steward_lib/assignment-eligible?` — a
  trial seat is a live seat, so it clears the same gate `assign()` clears.
- **The memory boundary** is BL-1178's `runTrialBoundaryMemoryTransfer`,
  composed by the bridge, never re-implemented. Babashka cannot import
  TypeScript, so the CLI shells to the compiled tool — the same bb → node
  bridge `handoffd` and `effective_backlog_depth_cli.bb` already use, with
  BL-1010's missing-tool message when the checkout has never been built.

## Refusals, each with its own reason

A nomination is refused when the role already has an armed trial, when the
candidate is not certified, when the candidate is already the permanent model,
and when the candidate lost a prior trial with no new evidence cited. They are
separate messages because an operator has to be able to tell them apart.

The last is invariant 2's teeth. A recorded loss carries the evidence it lost
with; a re-nomination citing the SAME evidence — or citing none — is refused,
and one citing new evidence is not. Without that, a losing model can be
re-seated every day forever, each nomination looking reasonable alone.

## Ordering that matters: the boundary runs before anything is persisted

On nomination the memory transfer runs BEFORE the trial is written and BEFORE
the seat moves. A failed transfer therefore leaves no armed trial to assess
later and no half-moved seat — which is BL-1178's invariant 2 ("never leave an
amnesiac seat as success") honoured by refusing rather than by reporting.

A **promotion owes no transfer**: the seat already runs the trial model, so
nothing switches. `boundary-for` returns nil for that case, and the shell test
asserts the end boundary is NOT called on a promotion — an easy over-firing
that would look harmless and would be a lie about what happened.

## The three declared invariants (BL-654)

In the Babashka property lane, where the lifecycle lives — driving these from
vitest would spawn a `bb` per draw, and a property that costs a second a run
gets its run count cut until it stops finding anything. Seeded LCG, never
`rand`: every failure prints its seed.

Generator reach is constructed, not hoped for:
- scores are drawn from a **three-value alphabet**, so exact ties — the whole
  of invariant 1's second clause — are ~1 in 3 rather than astronomically rare;
- invariant 2's every draw is a **losing** trial by construction (the trial
  score is drawn strictly below the permanent's), and the re-nomination is
  DERIVED from that draw's own candidate and evidence rather than drawn beside
  it;
- cost classes include `nil`, because unknown cost is a real registry state and
  its rank is the tie-break's edge case.

Ten reach floors are asserted. Measured over 500 runs each:

```
outrank 172 · outranked 160 · tie-cheaper-trial 65 · tie-cheaper-permanent 60
tie-equal-cost 43 · loss 500 · loss-without-evidence 180
no-change 148 · start-change 161 · end-change 191
```

**Non-vacuity, each shown by breaking the code and running:**

| invariant | break | result |
|---|---|---|
| 1 | a tie promotes even when the permanent is cheaper | P1 FAILS |
| 2 | a loss records no loser | P2 FAILS |
| 3 | a no-op switch still owes a boundary | P3 FAILS |

All three restored; the runner is green at 500 runs.

## Runs

| what | result |
|---|---|
| `model_steward_trial_lib_test_runner.bb` | ALL PASS (26 assertions) |
| `test_model_steward_trial_cli.sh` | ALL CHECKS PASSED (21 checks) |
| `bl1182_trial_lifecycle_property_runner.bb` | ALL PASS, 500 runs each |
| `extension/test/trialBoundaryMemory.test.js` | 9/9 |
| BL-1182 acceptance | 5/5 |
| `model_steward_test_runner.bb` (pre-existing) | ALL PASS |
| `test_model_steward_cli.sh` (pre-existing) | ALL PASS |
| the standing collision and mkdtemp guards | 27/27 |

## Not mine, still true

`suite_inventory_cli.bb` reports one problem — the manifest row BL-1276 added
for `task_scope_gate_acceptance_exemption_property_runner.bb`, whose name the
inventory's column-1 rule does not admit. Already surfaced to the specifier
during BL-1279; repeated here only so nobody reads it as this parcel's.

## Out of scope, left alone

The starting cast (BL-1181), declaring production go-live (BL-1183), and the
end-of-day sweep that would call `trial assess` on a schedule — `due?` is the
predicate such a sweep asks, and it is tested, but scheduling it is not in this
ticket. An operator ends a trial with `trial assess --role <role>` today.

## The split the specifier recorded and did not take

The ticket's notes record a safe decomposition (slice A: nominate/seat/always
revert; slice B: assess and promote) and asked the coder to request it rather
than invent another cut if the slice proved oversized. It did not: the four
verbs came to ~290 lines of lib plus a CLI command, and the three invariants
each span both halves, so building them together kept every one of them
testable in one place. No split requested.


## Architect bounce, 2026-08-30 — D1 and D2

**D1 (correctness).** `permanent-for-role`'s clause 1 — the trial ledger's own
recorded permanent, documented as winning over ModelFactory's overlay — was
dead code in every real invocation. `read-trials!` re-stringified the role keys
of `:active` and `:losers` but not `:permanent`, and `parse-json` keywordizes
any object key with no `/`, so a role written as `"coder"` came back as
`:coder`. Every CLI invocation is a fresh `bb` process, so the round trip
happened on every command after the one that wrote it.

The consequence was not cosmetic, and the architect reproduced it end to end:
after a promotion, an external write to the assignment overlay silently became
the "permanent" a later nomination recorded — and `assess` reverts a losing
trial to `(:permanent trial)`, so a losing trial could install whatever the
overlay had drifted to, over the model the ledger's own history adjudicated.

Fixed by applying the same re-stringify to `:permanent`, with a comment on the
whole block saying that EVERY role-keyed map needs it — the shape of the defect
is "one more map was added and the round-trip step was not".

Verified against the architect's own scenario: promote `trial-a`, drift the
overlay to `openai/drift-model`, nominate `trial-b` →

```
trial armed role=coder model=cerebras/trial-b permanent=cerebras/trial-a
```

the ledger's permanent, as documented, not the drifted overlay.

**The test gap that let it ship green, closed.** Every assertion in the lib
runner was in-process, and no test wrote then read trial state through JSON —
which is precisely the step the defect lives in. `model_steward_trial_lib_test_runner.bb`
now round-trips `write-trials!` / `read-trials!` through a real temp dir and
asserts `:permanent`, `:active` and `:losers` all resolve by STRING role
afterwards, plus that no role key comes back a keyword. Confirmed
red-capable: with the `:permanent` line removed it fails 2 assertions, naming
the value; restored, ALL PASS.

**D2 (minor).** The property runner's header pointed at
`backlog/evidence/BL-1182-property-non-vacuity-20260830.md`, which never
existed — the non-vacuity table is in this file. The comment now names this
file and says why it changed.

**Runs after the fix.** Lib runner ALL PASS (30 assertions), CLI shell test
ALL CHECKS PASSED (21), property runner ALL PASS at 500 runs/invariant with
unchanged coverage, acceptance 5/5.
