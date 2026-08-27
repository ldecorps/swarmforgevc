# BL-991 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `038cda9d85` (cleaner, straight merge with no changes of its
own on top of coder `01d3dcb724`) into the architect worktree. Merged first
(`git merge --no-ff 038cda9d85`), then read the ticket (including
`approval_context`'s two flagged design decisions and `constraints`' mandate
to amend BL-951's feature), then the coder's evidence.

## Scope

`swarmforge/scripts/swarm_handoff.bb` (`route-required-stages`, one new
guard), two sibling contracts amended (`specs/features/BL-951-…feature`,
`swarmforge/scripts/test/bl951_stage_skip_recording_property_runner.bb`, and
— beyond what the ticket named — `specs/features/BL-623-…feature` +
`bl623RoutingSkipTrailSteps.js`), a new feature
(`BL-991-a-declared-stage-is-never-jumped.feature`) + step handler + property
runner. Zero `extension/` files touched.

## Architecture

- Pure routing-decision logic in `swarm_handoff.bb`/`required_stages_lib.bb`,
  no IO/framework coupling introduced. The new guard is a `let`-bound
  `next-after-sender` computed once and consulted by both existing branches
  (membership and non-member rewrite) rather than duplicated logic — matches
  the ticket's own "How" direction ("expressible as one guard ahead of both
  branches") and keeps the fix from drifting the two branches apart.
- Reuses existing pure primitives (`next-required-stage`, `routes-forward?`)
  rather than adding a new comparison. The reuse of `routes-forward?` with
  `next-after-sender` in the sender-position argument (rather than an actual
  message sender) is a deliberate, correct repurposing — traced end to end
  below under Correctness read-through — not a new function that could drift
  from the original's semantics.
- No new subprocess, no new file IO, no new dependency edge — this is a
  same-file, same-module change to an existing pure decision function.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

This parcel touches no file under `extension/` (confirmed:
`git diff 78dc729c1 038cda9d85 --stat -- extension/` is empty), so there is
nothing of this parcel's for the gate to check. Full-repo scan reports only
the same pre-existing `telegram-front-desk-bot.ts` acyclic cycle every
recent architect pass has reported — already tracked as **BL-759** (paused),
re-verified against the ticket file itself before relying on memory. None of
this parcel's files.

## Co-change (`node extension/out/tools/co-change-report.js`)

`swarm_handoff.bb`'s top couplings are `required_stages_lib.bb`, its own
test runner, the sibling step handlers this same parcel amends
(`bl606RequiredStagesRoutingSteps.js`, `bl623RoutingSkipTrailSteps.js`), the
operator salvage paths named in the code's own comments (`redo_from.bb` +
`test_redo_from.sh`, `test_reroute.sh`), and `handoff-protocol.md` — all
expected, pre-existing structural coupling for this file's role as the
routing core, nothing surprising introduced by this diff. Nothing flagged
needs action.

## Invariants review (BL-633/BL-654) — 3 declared, all encoded, non-vacuous

1. **A declared stage is never jumped.** Traced the guard directly: for a
   forward hop with a usable declaration, `next-after-sender =
   next-required-stage(effective, sender)` is the first declared stage
   strictly after the sender, computed identically for both the membership
   and non-member branches — closing both holes the ticket names (a coder
   addressing QA on a full chain going straight to QA; a coder addressing
   architect on `[coder,cleaner,qa]` going to QA, jumping the declared
   cleaner). When that stage is strictly before the literal target, delivery
   is redirected to it; otherwise the pre-existing logic (membership check,
   then non-member rewrite) is unchanged. I independently re-derived by hand
   that this correctly reduces to identity for an already-correct hop
   (`coder→cleaner` on `[coder,cleaner,qa]`: `next-after-sender = cleaner`,
   not strictly before `cleaner` itself, so falls through to the unchanged
   membership branch) and to the documented redirect for both named holes.
2. **A deferred stage is never recorded as skipped.** The binding-rewrite
   branch calls `emit-skip next-after-sender nil` — never
   `emit-skip literal-to next-after-sender`, so `literal-to` (e.g. QA) never
   enters `:rewritten-away`; `emit-skip` derives its `:skipped` list purely
   from `hop-skipped-stages sender delivered` (the stages strictly *between*
   sender and the actual delivery target), so a stage the hop still reaches
   is structurally excluded from the record by construction, not by a
   separate check that could drift from the delivery decision.
3. **Enforcement reaches only where routing already reaches.** The new guard
   lives *inside* the `:declared`-source branch, itself already reached only
   past three pre-existing gates, each unchanged by this diff: (a) the
   top-level `(if-not (and (routes-forward? sender (first recipients)) (no
   rejection_reason) (no reroute_reason) ...))` — excludes backward bounces
   and detour headers before any BL-991 code runs; (b) the kill-switch check
   (`required-stages-routing-enabled?`) — the whole block is unreachable when
   disabled; (c) the `(if (or (nil? decision) (= :default-full (:source
   decision))) ...)` branch — absent/invalid declarations return before
   reaching BL-991's guard at all. I traced all three gates directly in the
   source rather than trusting the acceptance scenarios alone to prove it.

**Non-vacuity — I independently reproduced qa_e2e step 7 myself**, not just
re-read the coder's claim: rather than editing the deeply-nested `let`/`if`
structure (parenthesis-balance risk in a 15-level-deep nested form), I
surgically neutralized the guard's condition (`(if (and false
next-after-sender (routes-forward? ...)) ...)`), confirmed the file still
parses (`bb -e '(load-file ...)'` runs to the usage banner, not a read
error), then ran `specs/pipeline/scripts/run_acceptance.sh` on
`BL-991-a-declared-stage-is-never-jumped.feature`: **10 → 7 passing, and the
three failures are exactly scenario 01's three rows** (`not ok 1/2/3 - A hop
that would jump declared stages is delivered to the next declared stage`),
every other scenario (02, 03, 04's five rows) still green. Restored the file
from a pre-edit copy afterward; `git diff --stat` on the file is empty and
the suite is green again (10/10). This is the specific hole the ticket
exists to close, proven closed, not merely claimed.

The property runner's five documented breaks (guard never firing, guard
computed from `literal-to` instead of `sender`, binding rewrite recording
its deferred target as skipped, dropping the `rejection_reason` exemption,
kill switch ignored) are a superset of what I reproduced by hand; I did not
re-apply all five myself, having independently confirmed the highest-stakes
one (the guard not firing at all, which is exactly "no enforcement") and
having traced invariants 2 and 3 by reading the code's structural guarantees
directly (above) rather than only trusting a passing assertion.

No invariant violation found. No missing or vacuous property test.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

The touched pure surface (`route-required-stages`'s new guard,
`next-required-stage`, `routes-forward?` — both reused unchanged) is exactly
what the three declared invariants already cover; nothing else on the
touched surface is a natural round-trip/idempotence/ordering candidate
beyond what the property runner (80 real sends through the actual
`swarm_handoff.bb` `-main`, not a unit-level function call) already
exercises. Nothing undercovered. Nothing added.

## Sibling contracts amended — verified independently, not merely re-run

**BL-951 feature**: `full-chain` row removed from scenario 01's outline. The
comment left in place correctly explains why (`absent`/`invalid` still
resolve to `:default-full`, where the binding guard is unreached — verified
above under invariant 3 — so BL-951's "recorded whatever the declaration
says" point still has two live states). Re-ran: 6/6.

**BL-951 property runner**: read the diff directly rather than trusting the
green result alone. `oracle-delivered` computes what full-chain SHOULD
deliver to (the sender's immediate canonical successor) independently of the
code under test — genuinely a fresh oracle, not a tautology reading the
router's own answer back — and invariant 1's assertion for `:full-chain` now
checks "skips nothing, records nothing" rather than comparing it against the
`:absent`/`:invalid` skip lists (correct: a full-chain bound hop is adjacent
by construction, so it has nothing to skip, while `:absent`/`:invalid` still
compare against each other as before). Re-ran: `ok (12 sampled hops)`.

**BL-623 scenario 04 — the ticket's `constraints` section did not name this
one; the coder's consumer sweep caught it, and I verified the retargeting
independently rather than accepting the claim.** The old scenario sent
coder→QA on `[coder,cleaner,qa]` to produce a skip record naming cleaner —
exactly the jump BL-991 now forbids, so that hop no longer skips anything.
Retargeted to cleaner→QA on the same declaration: I hand-traced this through
the new guard (`next-after-sender = next-required-stage([coder,cleaner,qa],
"cleaner") = "qa"`, not strictly before the literal `"QA"` — same stage, so
the guard does not fire, and the hop falls through to the unchanged
membership branch, landing on QA exactly as addressed) and confirmed it
still produces a skip record spanning architect/hardender/documenter (none
of which are declared, so nothing declared is bypassed — correctly within
BL-991's "binding on declared stages only" scope per `approval_context`'s
second flagged decision). Re-ran: 7/7.

I additionally re-ran the full consumer sweep myself rather than trusting
the evidence table: BL-606 feature 18/18, BL-819 feature 12/12, BL-992
feature 5/5, `required_stages_test_runner.bb` ALL PASS,
`test_required_stages_ticket_lookup_collision.sh` ALL PASS — all match the
coder's recorded numbers exactly.

## Correctness read-through

Read `route-required-stages` end to end (the full ~100-line nested form),
`next-required-stage`, `routes-forward?`, `sender-position`, and
`hop-skipped-stages` in `required_stages_lib.bb`.

- The `routes-forward?` reuse (invariant 1's guard condition) is correct by
  construction: `next-after-sender` is always either `nil` or a genuine
  canonical-order stage name returned by `next-required-stage` (never
  `"specifier"`, which is `sender-position`'s only special case), so passing
  it as `routes-forward?`'s first argument resolves to a plain
  canonical-index lookup — exactly "is `literal-to` strictly after
  `next-after-sender`" — with no special-case surprise.
- `approval_context`'s two flagged design decisions (rewrite-not-refuse;
  binding scoped to declared stages only, preserving BL-606's pruning
  contract in the undeclared direction) are both correctly implemented, not
  just asserted in prose: the rewrite branch always redirects rather than
  erroring, and a declaration that OMITS a stage (e.g. `[coder,cleaner,qa]`
  omitting architect) still lets that omitted stage be pruned — traced via
  the `no-cleaner`/`documenter-only` rows, both of which fall through
  unchanged into the pre-existing pruning logic.
- The one cross-parcel finding in the coder's evidence (a property-generator
  seeding bias in `bl1057_host_switchover_doctor_property_runner.bb`, a
  DIFFERENT ticket's parcel I already reviewed and forwarded to the
  hardener with a clean verdict) is correctly out of scope here — the coder
  did not fix it in this parcel and routed it to the specifier by note
  instead, which is the right call (Article 4.3: not this parcel's fix to
  make). Not something for me to act on from this review either; noting for
  my own situational awareness only.

No correctness defect found.

## Verification re-run live (not trusted from the commit message)

- `bb …/bl991_binding_stages_property_runner.bb` → **ALL 80 SENDS PASSED**,
  reach counts matching the coder's recorded run exactly.
- `run_acceptance.sh` on `BL-991-…feature` → **10/10**; on the two amended
  siblings → **6/6** (BL-951) and **7/7** (BL-623).
- **Independently reverted the binding guard and re-ran BL-991's
  acceptance**: 7/10, failures exactly scenario 01's three rows. Restored;
  `git diff --stat` on the file empty; suite green again.
- Full consumer sweep re-run independently: BL-606 18/18, BL-819 12/12,
  BL-992 5/5, `required_stages_test_runner.bb` ALL PASS,
  `test_required_stages_ticket_lookup_collision.sh` ALL PASS — all match.
- `swarmforge/scripts/gherkin_lint_gate.sh` on all three feature files
  (BL-991, BL-951, BL-623) → parses cleanly.
- `required_wiring` (`bl991DeclaredStageNeverJumpedSteps` registered in
  `specs/pipeline/steps/index.js`) → confirmed present.
- Babashka lane, per engineering.prompt's Startup Tools: no mutation/CRAP/DRY
  tooling wired. The property runner plus the acceptance lane (across four
  feature files now) are its gate. No mutation/CRAP/DRY result is claimed —
  none was run, matching the coder's own recorded tooling-fallback note.
- Did not re-run the full `extension/ npm test` (8354 tests) myself since
  this parcel touches zero `extension/` files and the coder already
  recorded it unchanged (exit 0) on this same branch.
- qa_e2e step 8 (a live forward handoff on a real active ticket) is
  explicitly QA's post-landing check per the coder's evidence, not mine.

## Verdict

**NONE.** No architecture violation, no invariant gap or vacuous property
test, no correctness defect in the parcel. Both sibling amendments (BL-951,
and the BL-623 catch beyond what the ticket named) are independently
verified correct, not just re-run. Forwarding to hardener.

— By architect.
