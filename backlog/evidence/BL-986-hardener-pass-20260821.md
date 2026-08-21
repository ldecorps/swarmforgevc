# BL-986 — hardener pass: verified green, hand-mutation confirms dedup, PASS to documenter

**Parcel:** coder `c921a4032` (scan reference/ elaborations + dedup) merged
into cleaner `40bc51a7e`, then architect `87ddc66b9` (no separate architect
review evidence file was found for BL-986 specifically; the architect's
BL-986 tip was reached in the same session as their BL-979 review/bounce —
see entanglement note below). No code changes made in this pass — the
parcel arrived already thoroughly hardened by the coder, including a
property runner with generator-reach assertions and a hand-verified
non-vacuity table in `backlog/evidence/BL-986-coder-findings-20260821.md`.

## Tooling scope — Babashka/.bb, no mutation/CRAP/DRY wired

Per engineering.prompt's Startup Tools rule, Babashka/Clojure code has no
mutation/CRAP/DRY tooling wired and is gated only by its own unit-test
suite (`swarmforge/scripts/test/`). All three changed/added files here are
`.bb`: `standing_rule_violations_files.bb`, `standing_rule_violations_lib.bb`,
and the new `bl986_relocation_neutral_property_runner.bb`. Recorded per the
degraded-fallback discipline this rule requires.

## Independent reverification (registered detach, host load 22-46 throughout)

- `standing_rule_violations_lib_test_runner.bb` -> **ALL TESTS PASSED**
  (includes the KNOWN VIOLATION check against real committed articles:
  BL-252 counts 1, cited from `reference/engineering-detailed.prompt`;
  BL-250 and BL-255 both correctly hold at their expected origin/non-origin
  values).
- `standing_rule_violations_files_test_runner.bb` -> **ALL TESTS PASSED**
  (reference/ discovery, missing-reference-dir non-crash, extension filter).
- `bl986_relocation_neutral_property_runner.bb` -> **ALL PASS, 300 runs**
  (generator-reach assertions for all three placements — inlined,
  reference, both — confirmed exercised, not merely hoped for).
- BL-337 acceptance (`node specs/pipeline/cli.js
  specs/features/BL-337-standing-rule-violation-observable.feature`) ->
  **6/6 PASS**, exit code read directly (not through `tail`, per the
  ticket's own qa_e2e_procedure warning).
- Downstream consumers of `standing-rule-violations-lib`
  (`briefing_email_test_runner.bb`, `banked_briefing_test_runner.bb`,
  `briefing_generation_schedule_test_runner.bb`) -> **all ALL PASS**,
  confirming the widened/deduplicated scan does not regress any consumer.

## Hand-authored mutation (BL-638 pattern — no tool covers .bb code)

One hand-mutation of the ticket's own highest-risk line — the exact trade
its `constraints:` section warns against ("Widening the scanned set without
this would have traded the false ZERO this ticket fixes for a false
DOUBLE"):

- **Removed `(distinct-by (juxt :rule :citations))`** from `scan-violations`
  in `standing_rule_violations_lib.bb`. **KILLED** on both gates: the
  fixture test's "same rule in BOTH places is ONE violation record, not
  two" assertion failed (1 expected, 2 actual), and the property runner
  failed on the very first generated `:both`-placement case (and several
  more), e.g. `baseline: {"BL-582" 1}` vs `actual: {"BL-582" 2}`. File
  restored byte-for-byte (`diff` confirmed identical) before continuing.

Not pursued further: the coder's own evidence file already documents
non-vacuity in the OTHER direction (reverting the reference-file scan to
be ignored -> every reference-only case reads 0 against an expected 1),
so both halves of the dedup-vs-widen trade are independently confirmed
killed, one by the coder at authoring time, one by me here.

## Entanglement note (not a defect in this parcel, recorded for traceability)

The architect's BL-986 tip (`87ddc66b9`) sits on the same linear branch as
their BL-979 review, which they bounced to coder the same session
(`bounce_history` on `backlog/active/BL-979-...yaml`: architect -> coder,
class behavior, commit `f9377ad27a`). The bounced BL-979 commits were not
reverted out of the branch before BL-986 was processed on top of them,
which is contrary to "A Bounce Must Be Reverted Out Of The Bouncing
Branch." In practice this did not entangle BL-986: BL-979 touches only
`extension/src/concierge/pipelineBoard.ts` and its own tests/features,
completely disjoint from BL-986's `swarmforge/scripts/*.bb` files, and an
independent run of `extension/test/conciergeTick.test.js` here came back
111/111 green (not the 2/150 the architect's BL-979 evidence cited at
their earlier review point) — whatever that was, it is not present on this
tip and is not this ticket's concern. Flagging only so the entanglement is
visible in the trail; not bouncing BL-986 over it, since BL-986's own scope
is unaffected and BL-979 is already tracked separately with its own blame.

## Process/fixture hygiene

- `pgrep`/`ps` scoped check: clean, no orphaned `node --test`/`stryker`/`bb`
  processes from this pass.
- `git status --short`: clean after all runs — only the known pre-existing
  untracked `swarmforge/scripts/test/fixtures/` remains.
- Own scratch (`tmp/bl986-*.log`, `tmp/bl986-accept-work/`,
  `tmp/srvl.orig.bb`) removed after use.

## Inventory result

**D1..Dn: NONE.** No coverage gap, no correctness defect, no scope issue in
this parcel.

Forwarding this commit (evidence file committed) to documenter.

By hardender.
