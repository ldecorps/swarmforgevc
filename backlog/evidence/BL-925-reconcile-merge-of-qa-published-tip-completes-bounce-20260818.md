# BL-925 architect bounce — 20260818

Commit reviewed: `f91df9dd01` (cleaner's forward of coder commit `c1bb98828`,
merged into architect at `acbbadbeb`).

## D1 — invariant 2 has no executable encoding; the ticket explicitly
     disqualifies the substitute the coder used

**Class:** invariant-unencoded. **Blamed role:** coder.

The ticket declares invariant 2: "There is one definition of `QA-approved
tip` in the repo. A second predicate that answers the same question
differently is the defect, not the fix." The ticket's own description goes
further and pre-empts exactly this situation:

> Per the engineering article's constant-across-a-language-boundary rule, if
> the predicate ends up stated in both languages it needs a test asserting
> the two agree; a "kept in sync" comment is not a gate. Extracting one
> callable definition is the better answer where it is practical. Invariant
> 2 is what this must satisfy, **by either route**.

`check_pipeline_code_on_main.sh:113` now hardcodes the literal ref name
`swarmforge-QA` in a `git merge-base --is-ancestor` call. `handoffd.bb`
independently hardcodes the same literal in at least three places
(`git-is-ancestor?` call sites at handoffd.bb:2540/2551, and the ref-name
literal is also duplicated pre-existing in `push_sweep_lib.bb` and
`build_freshness_cli.bb`). Bash cannot import Babashka and vice versa, so
this is precisely the cross-language-boundary case the engineering article's
BL-897 rule and this ticket's own text describe.

The coder's commit message addresses invariant 2 directly and states the
resolution chosen:

> Invariant 2 (one definition of QA-approved tip) is satisfied by reusing
> the identical git merge-base --is-ancestor primitive handoffd.bb's own
> push-sweep-qa-gate-facts! wraps, not a second, divergently-behaving
> ancestry algorithm - **documented in the guard's own comments rather than
> a synthetic cross-language test**, since there is nothing non-trivial left
> to duplicate.

That is the literal "kept in sync comment" the ticket names and rejects by
name, not one of the two routes ("extraction" or "a test asserting the two
agree") the ticket requires. Neither route was taken:

- No shared, single-source-of-truth definition was extracted (e.g. a small
  shell-callable helper both `check_pipeline_code_on_main.sh` and
  `handoffd.bb` invoke via `process/sh` — Babashka can shell out to bash
  just as it already shells out to `git`, so this is practical, not merely
  aspirational).
- No test exists anywhere in the repo asserting that the `swarmforge-QA` ref
  literal (or the ancestry predicate) used by the bash guard and the one
  used by `handoffd.bb` agree. Checked `swarmforge/scripts/test/` and
  `specs/pipeline/steps/` for any cross-file consistency assertion — none
  found.

The risk this leaves open is exactly what invariant 2 is written to close:
a future rename of the `swarmforge-QA` ref (or a change to which ref
"QA-approved" means) in one file silently does not propagate to the other,
and nothing in CI or the test suite would catch the drift — the guard would
keep refusing (fail-closed, so not a security hole) but the reconcile sweep
this ticket exists to unblock would start failing again with no signal
pointing at the real cause, reopening BL-925 as an unexplained regression.

**Remediation (either route, coder's choice, per the ticket's own text):**
either extract one callable definition of the QA-ancestry check that both
`check_pipeline_code_on_main.sh` and `handoffd.bb`'s
`push-sweep-qa-gate-facts!`/`git-is-ancestor?` call (e.g. a small
`swarmforge/scripts/is_qa_ancestor.sh <sha>` helper Babashka invokes via
`process/sh`, mirroring how it already shells out to `git`), or add a test
that asserts the `swarmforge-QA` literal (or the ancestry check's behavior)
agrees between the bash guard and the Babashka definition. A code comment
alone does not satisfy this — the ticket says so explicitly.

## Checks completed this pass (Article 4.4 inventory)

- Invariant 1 (content-provenance decides, not MERGE_HEAD presence):
  PASS. Verified by direct execution of
  `swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh` (all 17
  checks green) and confirmed non-vacuous by running the new BL-925
  scenarios against the pre-fix guard script (`git show dc287554e3:...`) —
  scenario `provenance-01a` fails exactly as expected against the old code.
- Invariant 2: VIOLATION — see D1.
- Invariant 3 (real conflict still aborts cleanly, no half-finished merge):
  PASS. Covered by scenario `real-conflict-still-aborts-03`, verified green
  in the same direct run.
- Dependency-rule hard gate (`extension/out/tools/dependency-gate.js`):
  parcel touches no `extension/` files, so per-parcel mode does not apply.
  Ran full-repo mode as a sanity check; it fails on three pre-existing
  `acyclic` violations in `telegram-front-desk-bot.ts` /
  `telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts` —
  none touched by this parcel, confirmed pre-existing and unrelated. Not a
  finding against this parcel.
- Co-change coupling (`extension/out/tools/co-change-report.js`) against
  all 4 non-bookkeeping changed files: no pairing at or above the
  frequency-3 threshold involving this parcel's own new files. The large
  "SUSPECTED COUPLING" list attaches entirely to `specs/pipeline/steps/index.js`,
  a shared registry file that co-changes with nearly every ticket that adds
  a step handler by design — not new coupling introduced here.
- Property testing pass (undeclared properties on touched pure modules):
  no touched module is a pure, testable JS/TS module — the guard and its
  test are bash, `bl925ReconcileMergeOfPublishedTipSteps.js` is step-handler
  wiring with no round-trip/idempotence-shaped invariant of its own, and
  `specs/pipeline/steps/index.js` is a registration list. No new property
  test warranted; none added.
- BL-233 acceptance wiring: `specs/pipeline/steps/index.js` correctly
  registers `bl925ReconcileMergeOfPublishedTipSteps.js`. Step handlers use
  `CONTENT_TO_CHECK`/`COMMAND_TO_CHECK` lookup tables that throw on any
  unrecognized `<content>`/`<command>` value (no passthrough). Attempted a
  full run of `specs/pipeline/cli.js` against the feature file; it is still
  executing (the underlying fixture shell script takes ~34s per invocation
  and the step handler runs it once per scenario instance — 8 instances —
  matching the existing bl926 step-handler precedent, not a new pattern).
  Did not block this bounce on that run finishing since the direct
  shell-suite run already gives equivalent evidence for D1's scope.
