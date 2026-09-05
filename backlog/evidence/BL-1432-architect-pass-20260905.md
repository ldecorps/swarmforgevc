# BL-1432 — architect pass, 2026-09-05

Ticket: BL-1432-the-land-walk-ranges-over-the-parcel
Role: architect
Commit reviewed: 9829eacb76 (cleaner NONE pass)

This is the ticket whose ruling I helped the user reason about earlier
today (recommending option 3) before it was reopened and confirmed by the
human directly in the specifier pane — reviewing the delivered "option 3,
both" implementation now.

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd**, independently re-run (new step handler against the sibling
  pattern it was modeled on, `bl1026StageBudgetStatedOnceSteps.js`):
  `0 clones`.
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"The walk's cost is a function of the parcel, never of the QA
   branch's age"** — read `parcel-own-base` (`task_scope_gate_lib.bb`):
   reuses `last-handoff-commit`/`effective-base`, the exact machinery the
   send-time scope gate already uses, never a second implementation.
   `land-plan`'s `walk-base` computation
   (`(or (parcel-own-base ...) origin-main)`) confirmed live by default —
   `land_step_cli.bb`'s own call passes no `:base` key, so option 2 is
   wired into production without further change, independently confirmed
   by reading the call site myself.
2. **"What counts as entangled, landed or own does not change... a
   narrower range must not hide an unlanded sibling"** — confirmed
   `origin-main` stays threaded unchanged everywhere a landed/unlanded
   verdict is read (`entangled-siblings`, `own-paths`), while only the
   candidate range narrows via the separate `walk-base` parameter. Read
   every touched call site directly — the two notions never conflate.
3. **"Nothing in flight is ever discarded"** — read `post-land-repoint!`:
   checks `in_process` before the generic dirty check (mirroring BL-1421's
   own ordering, since an in-process mailbox file is untracked and would
   otherwise misreport as a generic uncommitted change), refuses `git
   reset --hard` on either condition, and logs every outcome (repointed or
   skipped, naming why) to a durable log.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `land_step_lib.bb`, hardcoded `walk-base` to always equal
`origin-main` (ignoring `:base`/`parcel-own-base` entirely), reran the bb
unit suite: **2 failures** — `land-plan :base - the SAME tip, bounded,
sees nothing before base` and `...names the sibling` — reproducing
exactly the pre-fix defect this ticket exists to close (a stale sibling
misread as entangled, and an old sibling double-counted alongside the
real new one). Restored the file, confirmed byte-identical via `diff` and
`git status --short` (empty), reran — `ALL PASS` again.

## Independently re-verified the substance

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — **ALL
  PASS**.
- `bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb` — **ALL
  PASS**.
- `node specs/pipeline/cli.js
  specs/features/BL-1432-the-land-walk-ranges-over-the-parcel.feature` —
  **5/5 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-668-post-qa-deterministic-branch-sweep.feature`
  (regression) — **5/5 pass**.
- Land-step sibling features (`BL-1354`, `BL-1389`, `BL-1431`, `BL-1375`)
  — **5/5, 5/5, 4/4, 7/7 pass**, no regressions.

All matching both the coder's and cleaner's claimed counts exactly.

## The cleaner's flagged live-wiring gap — independently confirmed, agree with the routing

The cleaner's evidence flags that `post-land-repoint!` (option 1, the
re-point) has **no live production call site** — confirmed myself via
`grep -rn post-land-repoint swarmforge/scripts/*.bb
specs/pipeline/steps/*.js`: only the function's own definition and the
acceptance step handler reference it; `land_step_cli.bb`,
`post_qa_branch_sweep_lib.bb`, and `handoffd.bb` never call it. This means
the human's ruled "option 3, both" is only half live today — the bounded
walk (option 2) runs automatically in production, but the branch re-point
does not, so `qa_e2e_procedure` step 2's live timing/re-point assertion
cannot be satisfied by this parcel alone.

Agree with the cleaner's routing of this as a QA-gate judgment rather than
a bounce: the coder's own evidence transparently discloses the scope call
(citing the ticket's own `required_wiring`, which names only the
step-handler file, and the "How" section's explicit "may be the place"
framing — genuinely negotiable, not a mandate on which module owns the
call site). The acceptance FEATURE tests `post-land-repoint!` as a
standalone mechanism by design (scenario 03/04's own Given/When text),
so the automated gate is satisfied; it is `qa_e2e_procedure` step 2 —
QA's own LIVE check — that will surface this gap, and QA is
already equipped to catch it (the step explicitly measures the post-land
branch-count assertion). Not a silent defect: the very next gate's own
written procedure is the mechanism that catches it, unlike a case where
no existing check would ever surface the gap.

Functionally, note the two performance problems this ticket was minted to
fix (slow lands racing mint cadence; inflated `ENTANGLED_SIBLING` reports
naming done tickets) are both already resolved by the bounded walk
(option 2) ALONE, live today, regardless of whether the branch is ever
re-pointed — the walk no longer inspects the ever-growing full branch
history either way. The missing re-point wiring leaves the QA branch's
on-disk history growing unbounded (a real, but lower-urgency, hygiene
concern than the original performance/inflation problems), not a
regression of what this ticket already fixes live.

## required_wiring

`specs/pipeline/steps/bl1432LandWalkRangesOverTheParcelSteps.js::registerSteps` —
present, discovered by directory scan (BL-1371), confirmed by the
acceptance run passing 5/5.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. The cleaner's flagged live-wiring
gap for `post-land-repoint!` is independently confirmed accurate and
correctly routed to QA's own gate (its qa_e2e_procedure step 2 already
tests for exactly this). Forwarding to hardener, with the flag carried
forward via the cleaner's evidence file (already in the chain QA reads).
