# BL-1341 — hardener pass (20260902)

Received: architect commit `fd46a98f52` (cleaner `479373f6a9`, forwarding
coder's second-direction fix `c90be7587e..963dec3774`), unchanged.

## BL-149 cooldown gate

`swarmforge/scripts/check_merge_deletion.sh` — **run** (5.40 days old,
host quiet, load 3.5-6.6/20 cores throughout the pass).

## Real gap found and closed: the both-sides dedup silently lost one side's name

`collect_deletions`'s dedup path (`side_of["$path"]="${side_of[$path]}
and $side"`) is the ONLY place that combines both directions' findings
into the single-report-per-path guarantee (BL-1242 scenario 04's
discipline, carried across the new direction). The existing test 13
only asserted the path appears once in the output — never that the
message names BOTH sides. Hand-mutated the append to a plain overwrite
(`side_of["$path"]="$side"`, dropping whichever side was recorded
first): **survived** the full 13-test suite and the property test
unnoticed. A resolver reading the refusal for a both-sides drop would
then see only "on the incoming branch", silently losing "and this
branch was your OWN branch's version too" — exactly the kind of
diagnostic loss this ticket exists to prevent, just for the dedup path
rather than the primary one.

Added test 13b: asserts the single finding's text contains BOTH
`"this branch"` and `"the incoming branch"`. Confirmed the mutant is now
killed (isolated to exactly the new assertion) before restoring
(`git diff --stat swarmforge/scripts/check_merge_deletion.sh` empty
afterward).

## Two further mutants probed, both already killed by the existing suite

- Removing the `MERGE_HEAD` attribution fallback in `ticket_id_for_path`
  (an incoming-only path would otherwise report `(unattributed)`,
  becoming unexemptable by naming its own ticket): killed by test 10
  ("refusal must name the incoming path's ticket").
- Disabling the second `collect_deletions "$MERGE_HEAD_SHA" "the
  incoming branch"` call entirely (the whole second direction): killed
  by the property test's `incoming`-shape run ("a incoming-side drop
  was waved through").

## Non-vacuity re-verified independently

Hand-disabled the same second-direction call and ran
`bl1341MergeDropsEitherSideInvariants.property.test.js` directly (not
relying on the architect's flakiness analysis alone, which addressed
reach/flake risk but not whether the property catches a real
regression): failed as expected ("a incoming-side drop was waved
through"). Restored, byte-identical `git diff`, re-ran clean (1/1).

## Mutation manifest (flagged by the architect, out of coder/cleaner
scope per Guardrails — same disposition as BL-1340 earlier today)

`specs/features/BL-1242-merge-never-silently-drops-branch-work.feature`
had NO prior mutation stamp (the architect confirmed this — the feature
never carried one before this ticket's rewrite). Ran
`run_gherkin_mutation.sh <feature> <fresh mktemp under ./tmp/>
specs/pipeline/steps/index.js hard` (host quiet, load 3.5/20 cores) — all
three `Scenario Outline:` blocks mutated clean: 4/4, 6/6, 4/4 (14/14
total), 0 survived, 0 errors. Stamp and manifest written by the tool
itself, never hand-edited. Work dir removed after the run
(`rm -rf ./tmp/bl1242-mutation-*`), never `.` and never a tracked path.

## Verification (all green)

- `bash swarmforge/scripts/test/test_merge_deletion_guard.sh` — ALL PASS
  (13 tests, +1 new: 13b)
- `npm run test:properties -- test/bl1341MergeDropsEitherSideInvariants.property.test.js`
  — 1/1
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1242-merge-never-silently-drops-branch-work.feature`
  — 12/12 (re-ran after the manifest re-stamp too)
- Full unit suite (`npx vitest run`, no exclusions): 571 files, 9899
  tests, 9874 passed / 25 failed — the exact same pre-existing,
  already-ticketed standing reds documented throughout this session.
  Zero new failures.

## CRAP / DRY

No production TypeScript file changed by this ticket (the fix is
entirely shell; the coder's touched TS file is only the property test,
excluded from CRAP/DRY per the shared property-test-separation rule).

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean.
`git status --short`: only the intended diff plus the same two
pre-existing untracked files noted throughout this session.

## Verdict

One real gap found and closed (the both-sides dedup path silently lost
one side's name — the exact diagnostic-loss class this critical-adjacent
ticket exists to remove, just on its own dedup branch). Two further
mutants probed and confirmed already covered. Mutation manifest
re-stamped clean. No other defect. Forwarding to documenter.

By hardener.
