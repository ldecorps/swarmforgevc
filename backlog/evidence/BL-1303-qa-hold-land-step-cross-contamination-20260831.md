# BL-1303 — QA hold: land-step replay drops BL-1303's own production files

**Verdict: BL-1303's own work verified CORRECT and fully green (details
below). NOT landed.** This is not a bounce — no defect found in coder/
cleaner/architect/hardener/documenter's own work on this ticket. The
blocker is the shared land-step tooling (BL-1241 remedy, `land_step_cli.bb`
/ `task_scope_gate_lib.bb`), the mirror image of the hold this same
tooling forced on BL-1298 earlier today
(`backlog/evidence/BL-1298-qa-hold-land-step-blind-spot-20260831.md`).

## Independent verification of BL-1303's own work (all green)

- Ancestry (BL-336 discipline): coder, cleaner, architect repass
  (`98289aaf7c`), hardener CRAP<=6 pass (`c5572e8a94`), documenter
  (`c80659f7ec`) all confirmed ancestors of the QA tip `ab8d10a8b3`
  (`git merge-base --is-ancestor`, checked individually).
- `npm run compile` (extension/): clean.
- Full unit suite (`npm run test`, `CURSOR_API_KEY` exported for this
  session — its absence is a pre-existing session/env gap, unrelated to
  any code; confirmed by toggling it): 570/585 files, 9817/9842 tests
  pass. 15 files / 25 tests fail — **exactly** the standing-red set the
  same-day BL-1305 QA pass recorded (BL-1221/1263/1265/1289/1290/1291),
  zero overlap with this ticket's diff.
- Property suite (`npm run test:properties`, run fully detached per the
  known 2-minute harness cap — see BL-1305's QA pass note for the same
  workaround): 270/295 files, 826/840 tests pass. 25 files / 14 tests fail,
  24 of 25 on `swarmforge/scripts/property_suite_standing_allowlist.tsv`
  (BL-1175). One file off the allowlist,
  `test/bl1071SweepSurvivesAnyProbeFailure.property.test.js`, timed out at
  20000ms under host load; re-run in isolation twice, passed both times in
  14.6s and clean — a host-load flake (BL-1071 is a `done` ticket untouched
  by this diff), not a new regression. BL-1303's own property file
  (`bl1303FeatureHandlerRegistration.property.test.js`) passes on its own,
  separately.
- Acceptance: `run_acceptance.sh
  specs/features/BL-1303-a-feature-on-main-always-has-a-registered-handler.feature`:
  7/7 scenarios pass.
- Shell suites, all green: `test_pre_merge_commit_hook.sh` (9/9),
  `test_run_commit_guards.sh` (12/12), `test_check_feature_handler_registration.sh`
  (7/7).
- `required_wiring` anchors, all 3 confirmed present: `run_commit_guards.sh`
  (`run_guard check_feature_handler_registration.sh`), `pre-merge-commit`
  (same guard, closing the merge-path gap the earlier bounce named),
  `specs/pipeline/steps/index.js:910` (`bl1303FeatureHandlerRegistrationSteps`).
- CRAP<=6 independently re-verified (`node scripts/crapReport.js` against
  the 5 changed files, coverage regenerated first via `vitest run --coverage`
  scoped to this ticket's own two unit-test files): every function at or
  under CRAP 6. Matches hardener's own evidence.
- Docs (`docs/reference/Specification.MD`,
  `docs/reference/BL-632-commit-time-guard-refuses-pipeline-code-on-main.md`)
  and diagram-currency (grepped `docs/diagrams/*.mmd`: only pre-existing
  changelog comments, no graph node/edge depicts commit-hook internals, no
  change-trigger fired) independently re-verified against the documenter's
  own claims — agree.
- **Real merge-path integration test against actual git hooks** (not just
  the unit/acceptance fixtures), in a scratch clone with
  `core.hooksPath = swarmforge/git-hooks` set to match the real repo:
  merging in this ticket's own tip cleanly succeeds; a second branch that
  then drops BL-709's `index.js` registration is REFUSED on `git merge
  --no-ff`, naming the exact offending feature and handler, matching
  `qa_e2e_procedure` step 6 verbatim. Confirms the guard's fail-closed
  behavior against real githooks(5), not just its own test harness.
- Orphan process check clean before and after every lane (`pgrep -fl
  'node --test|stryker|vitest'`).

## The land-step defect (same BL-1315-shaped hole, opposite direction)

Ran `bb swarmforge/scripts/land_step_cli.bb
BL-1303-a-feature-on-main-always-has-a-registered-handler ab8d10a8b3`.
Result:

    LAND_REPLAY land-replay/BL-1303-ab8d10a8b3 b4151e20989341cfb229dd8ca1a4d9d14ca9fdab
    ENTANGLED_SIBLING BL-1298
    ENTANGLED_SIBLING BL-1305
    ENTANGLED_SIBLING BL-1315

Per BL-1307's written guidance ("a named entangled sibling is not proof the
tip is clean") and this same day's BL-1298 precedent, reviewed the replay
tip by hand rather than trusting it. **It is not clean — it is missing
BL-1303's own core deliverables:**

    extension/src/tools/check-feature-handler-registration.ts   MISSING (CLI entrypoint the guard shells out to)
    extension/src/tools/featureHandlerRegistrationReport.ts     MISSING
    extension/src/tools/featureHandlerRegistrationText.ts       MISSING
    extension/src/tools/featureHandlerRegistrationTypes.ts      MISSING
    specs/pipeline/steps/bl1303FeatureHandlerRegistrationSteps.js MISSING (the step handler)
    specs/pipeline/steps/index.js `bl1303` registration line     MISSING (diff empty vs origin/main)
    extension/test/checkFeatureHandlerRegistrationCli.test.js    MISSING
    extension/test/bl1303FeatureHandlerRegistration.property.test.js MISSING
    swarmforge/scripts/test/test_check_feature_handler_registration.sh MISSING

Confirmed by checking out the replay tip into an isolated worktree: the
guard IS wired into `run_commit_guards.sh`/`pre-merge-commit` (those files
made it in), but `check_feature_handler_registration.sh`'s own `CHECKER`
path (`extension/out/tools/check-feature-handler-registration.js`) has no
source to compile from, and `specs/features/BL-1303-...feature` (present)
has no registered handler. **Landing this replay as cited would wire a
guard that fails closed on every subsequent commit and merge to `main`
forever** (`$CHECKER is missing (run npm run compile from extension/)`) —
a self-inflicted total pipeline deadlock — while simultaneously landing
BL-1303's own subject defect (an unregistered feature) under its own
ticket.

**Root cause, by inspection (not fully diagnosed — shared tooling, not
this ticket's to fix):** BL-1298's own cited commit (`86c2ed1c2d`) already
carries these exact BL-1303 files as second-parent passenger content (per
its own QA-hold evidence file), and BL-1298's own dangling, unlanded replay
attempt (`land-replay/BL-1298-86c2ed1c2d`, commit `adb6e0beff`, left in
place per that evidence file's own disposition — "do not land it as cited")
also carries them. Whatever `task_scope_gate_lib.bb`'s ownership
computation does with an entangled sibling's overlapping paths, the
practical effect observed here is that files legitimately and exclusively
authored by BL-1303's own commits (confirmed via `git log --oneline -S` /
`--follow` on each path) got excluded from BL-1303's OWN replay because a
different ticket's still-unlanded, still-dangling replay branch also
touches the same paths. This is the mirror image of BL-1298's hold from
this morning, and neither ticket can land first without the other's
dangling state interfering — a chicken-and-egg shape the specifier should
see whole rather than either QA session guessing at independently.

## Why this is not a bounce, and not a hand-rolled fix

No role in this ticket's chain owns a defect — coder through documenter's
work is independently verified correct above. `land_step_lib.bb`/
`task_scope_gate_lib.bb` are shared swarm machinery outside this ticket's
`required_stages`. Per QA.prompt ("this remedy has a tool, do not
hand-roll the replay") and BL-1307's own precedent, stripping the missing
files back in by hand, or force-landing the originally-cited commit
`ab8d10a8b3` to bypass the tool (which would carry BL-1298's, BL-1305's,
and BL-1315's own unapproved/unbuilt work along as passengers — the exact
bypass BL-1241 exists to prevent), are both out of scope for this role.

## Disposition

**QA HOLD.** `ab8d10a8b3` sits merged into `swarmforge-QA`, verified,
fully green, not reverted — no defect in BL-1303's own work. Not landed,
not forwarded, not bounced. `land-replay/BL-1303-ab8d10a8b3` (commit
`b4151e20989341cfb229dd8ca1a4d9d14ca9fdab`) left in place, unlanded, as
inspectable evidence — do not land it as cited, it is missing files.

Sending the specifier a `note`, priority `00`, naming this evidence file,
BL-1298's mirroring one, and the three entangled tickets (BL-1298, BL-1305,
BL-1315) so the cross-contamination is visible as one shape rather than two
separate reports.

By QA.
