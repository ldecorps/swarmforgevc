# BL-663 architect bounce — 2026-08-01

## Inventory (Article 4.4 — complete pass, single item found)

### D1 — declared invariant 1's expedite-lane component has no property test

- **Failing command**: none to run — this is an absence, confirmed by
  reading every test file touching `promotion_gates_lib.bb`:
  `grep -n -i "expedit\|rank-candidates\|rank-key"
  swarmforge/scripts/test/promotion_gates_lib_test_runner.bb
  swarmforge/scripts/test/promotion_gates_lib_property_runner.bb
  swarmforge/scripts/test/promotion_gates_cli_test_runner.bb`.
  Result: `expedited?` and `rank-candidates` appear only in the
  EXAMPLE-based runner (`promotion_gates_lib_test_runner.bb`, a handful of
  hand-picked fixtures — one 2-candidate ranking check, a handful of
  `expedited?` truth-table rows) and in one Gherkin acceptance scenario
  (`BL-663 expedite-lane-enforced-03`, ONE example: a single defect/high vs
  a single feature at fixed priorities 80/5). Neither is a property test.
  `promotion_gates_lib_property_runner.bb` defines exactly three properties
  (P1: `evaluate` composition over held?/human_approval/depth/orthogonality;
  P2/P3: `route-target` rewrite semantics) — its own header enumerates only
  "the ticket's two declared invariants" as P1 (gates) and P2/P3
  (assigned_to rewrite), and never mentions `rank-candidates`/`expedited?`
  anywhere, including in the "non-vacuity proven by hand" paragraph (which
  names only the orthogonality branch and the specifier-routing branch as
  the deliberately-broken cases exercised).
- **Commit hash reviewed**: d85cb66388cbcf4eed078a1497f8c49267928232 (QA's
  bounce-evidence commit, holding the full BL-663 chain forward through
  hardener and documenter).
- **Failure class**: `invariant-unencoded` (architect.prompt Invariants
  Review — a missing property test for a declared invariant is itself a
  send-back, distinct from a violated-property `behavior` bounce).
- **Expected vs observed**: BL-663's own YAML declares invariant 1 as ONE
  invariant spanning six named concerns: "human_approval, assignee/spec-stage,
  Article 3.2.4 expedite ordering, depth, orthogonality, hold/park markers."
  Expected: each of those six concerns encoded as a property test quantifying
  over a broad input range, per the property-runner file's own stated
  rationale for existing ("the example-based runner ... only ever breaks ONE
  gate at a time per example. P1 here quantifies over every combination...").
  Observed: 5 of 6 are covered (P1 covers held?/human_approval/depth/
  orthogonality; P2/P3 cover assignee/spec-stage). The 6th — Article 3.2.4
  expedite ordering, i.e. `expedited?` classification and `rank-candidates`/
  `select`'s ranking of an arbitrary-sized, arbitrary-priority candidate set
  — has zero property coverage and no stated non-encodability reason.
- **Why this one matters more than an average gap**: expedite-lane ordering
  is not an incidental concern here — it is the ticket's OWN headline defect
  class. Of the four recorded historical instances in this ticket's
  `source:` section, THREE (instances 1's "standing watch" partially, 2, and
  4) are expedite-lane violations where "a gate exists but a combination
  slips through" per the property-runner file's own description of exactly
  this bug shape — and instance 4 is a RECURRENCE five days after the
  ticket was filed, i.e. the exact failure mode property testing exists to
  catch (an example suite passing while an untested combination — a
  different priority spread, three-plus candidates, a tie, a `bug`-typed
  legacy ticket mixed with a `defect`-typed one — still slips through). The
  most safety-critical invariant in the ticket currently has the thinnest
  test rigor of any of the six gates.

## Remediation pointer

Owning role: **coder** (architect.prompt Invariants Review: "you are never
the first author of a declared invariant's property test — that authorship
rests with the coder... if none exists and no reason was stated, that is the
defect").

Add a property test to `swarmforge/scripts/test/promotion_gates_lib_property_runner.bb`
(a P4, alongside P1–P3) that:
- generates an arbitrary-sized candidate set with mixed `type`
  (`defect`/`bug`/`feature`/other), mixed `severity`
  (`critical`/`high`/`medium`/absent), and arbitrary `priority` values
  (including ties and the legacy-`bug`-vs-`defect` mix explicitly called out
  in Article 3.2.4's transition clause), and asserts `rank-candidates`
  always picks an expedited candidate over every non-expedited one
  regardless of priority number, with priority/id as the only tie-break
  within each bucket (mirrors `rank-key`'s own two-part contract);
- follows the same non-vacuity discipline already used for P1–P3 (run
  against a deliberately broken `rank-key`/`expedited?` — e.g. drop the
  expedited-bucket term so ranking falls through to pure priority order —
  confirm it fails, then restore), and the same generator-weighting
  discipline (an interesting-shape bucket so "at least one expedited
  candidate present" isn't a rare draw, per this file's own recorded
  "uniform draw passed hundreds of runs against a live defect" lesson).

No other item found in this pass — dependency-gate.js (BL-259 hard gate)
does not apply (no `extension/src`/`extension/media` files in this parcel);
`co-change-report.js` surfaced only pre-existing background coupling
(`route_backlog_to_coder.sh` ↔ `swarmforge.sh`, unrelated to this diff);
module boundaries, the pure-lib/thin-CLI split, and invariant 2
(assigned_to rewrite, both sites) all check out; the Gherkin step handlers
drive the real scripts against a real fixture repo, no fake-acceptance
smell. Forwarding to hardener is withheld pending P4.
