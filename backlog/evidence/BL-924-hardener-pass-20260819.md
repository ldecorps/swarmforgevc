# BL-924 hardener pass — 2026-08-19

## Reviewed commit
`cf98cea432` ("BL-924: architect pass - fixture-leak fix verified,
forwarding to hardener"), merged into hardener as `4588efe86` (this
parcel). Bounce history: 1 architect bounce (D1, fixture-leak hygiene),
fixed by coder (`5fc13dd79b`), re-verified clean by architect
(`cf98cea432`).

## Scope, precisely
`git diff 576f466b28^ 5fc13dd79b --stat` includes noise from sibling
tickets (BL-817, BL-914, BL-631) pulled in by the merge graph. BL-924's
own 7 files, confirmed by scoping the diff to them directly: the ticket
YAML, `bl924HotSyncedCopiesDoNotBlockMergeSteps.js`, `index.js`'s
registry line, `clear_identical_untracked_and_merge.bb`,
`untracked_collision_clear_lib.bb`, and their two test runners. The
feature file was not touched here (specifier wrote it already).

## Tooling scope check
No `extension/src/*.ts` file touched — Stryker/CRAP/DRY inapplicable, same
as the two other tickets in this batch. `untracked_collision_clear_lib.bb`
and `clear_identical_untracked_and_merge.bb` are Babashka — no
mutation/CRAP/DRY wired at this language boundary
(engineering.prompt's Startup Tools note), gated by their own suites.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: load averages 8–12 on 4 cores.
   Ran the gate against all 6 changed production/test files: 5 reported
   `DECISION: skip-busy`, `index.js` reported `skip-cooldown` (age 0.05
   days). **BL-113 Gherkin mutation over the feature's `Scenario Outline`
   (scenario 01, 2 Examples rows) is deferred to the next quiet pass** —
   gate-driven, not skipped. Partially offset by item 5 below: the
   architect's own non-vacuity check already exercised the pure lib's
   logic under an inverted mutant, which is mutation testing in substance
   even though it did not run through the BL-113 harness.
2. **Independent re-run of both existing suites** (not trusted from either
   evidence file):
   - `bb swarmforge/scripts/test/untracked_collision_clear_lib_test_runner.bb`
     — **ALL TESTS PASSED** (the pure decision-logic unit runner).
   - `bash swarmforge/scripts/test/test_clear_identical_untracked_and_merge.sh`
     — **7/7 PASS** (real-git wiring test, scenarios 01–05, including the
     invariant-2 no-branch-content-survives case).
   - `run_acceptance.sh
     specs/features/BL-924-hot-synced-untracked-copies-block-fast-forward.feature`
     — **4/4 PASS**, matching both architect passes.
3. **Fixture-leak re-verification (the bounced defect)**: ran the
   acceptance feature myself and counted `sfvc-bl924-root-*` dirs under
   `$TMPDIR` immediately after — **0**, confirming the `afterEach`-based
   cleanup fix holds under an independent run, not just the architect's
   own. (Prior bounce measured 32 accumulated dirs before the fix landed.)
4. **Post-run leak check (own standing duty)**: no orphaned `node --test`
   or `stryker` process from my own runs (one unrelated `node --test`
   process belongs to the coder's own concurrent worktree, not mine — left
   untouched); no stray tmux servers; `git status --short` clean.
5. **Own correctness read of `clear_identical_untracked_and_merge.bb`**
   (beyond the architect's two passes): traced `identical-to-ref?`'s
   failure modes for the read side — a directory, a symlink to nowhere, or
   genuinely non-UTF8-decodable content at the candidate path all throw
   inside the `try`/`catch`, which resolves `on-disk` to `nil`, which
   makes `(some? on-disk)` false, which makes the file NOT identical —
   i.e. every read failure mode fails CLOSED (blocks the merge, matching
   invariant 1's refusal side), never open. No case found where a read
   failure could be misread as "identical" and cause an unrecoverable
   delete.
6. **Required wiring**: `index.js` registers
   `bl924HotSyncedCopiesDoNotBlockMergeSteps` — confirmed by grep. (The
   ticket itself declares no `required_wiring:` block, per its own notes:
   an entry here would pass vacuously per BL-874 — correctly omitted.)

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling (Babashka
boundary, no `extension/src` touched). BL-113 Gherkin mutation deferred
per the BL-149 cooldown gate (host busy), substantially offset by the
architect's own already-executed non-vacuity mutation check on the pure
decision function. Bounced fixture-leak defect independently
re-confirmed fixed (0 leaked dirs after my own run). Both existing test
suites and the acceptance feature re-run green under my own hand. A small
independent correctness read of the read-failure paths in the merge
script found every failure mode fails closed (refuses rather than
deletes), consistent with invariant 1.

Forwarding to documenter.

By hardener.
