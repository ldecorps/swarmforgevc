# BL-1641: bounce fix (D1) — coder

Architect's bounce (`backlog/evidence/BL-1641-bounce-20260921.md`) found
one defect, D1, blamed on coder: `mainHasBriefing`
(`extension/src/tools/night-closing-ceremony-run.ts`) fails OPEN on any
git-level read error, contradicting its own documented fail-closed
contract - `git cat-file -e main:<path>` exits non-zero (128) both for a
genuinely absent path AND for every other git failure (missing/corrupt
`main` ref, "not a git repository"), and the old `catch { return false;
}` collapsed all of them into "absent" (= safe to write).

## Fix

`mainHasBriefing` now inspects the caught error's stderr: only the
specific "fatal: path '<path>' does not exist in 'main'" shape (the ref
itself resolved fine, the path genuinely is not there) reads as `false`
(absent). Every other failure - a missing/corrupt ref ("invalid object
name 'main'"), no repository at all, anything unrecognised - reads as
`true` (fail closed: "main might already have it", so neither
`landDocumenterBriefing` nor `composeHeadlessBriefing` writes past the
guard).

## Coverage gap closed

`mainHasBriefing` is now exported (same precedent as
`spawnConsultDocumenter`) so it can be driven directly against a real git
fixture without a full write-capable pipeline (documenter branch,
`commit_integrity_cli.bb`, etc.) masking the guard's own answer behind
unrelated degrade-quietly branches. Four new tests in
`extension/test/nightClosingCeremonyRun.test.js`:

1. `main` ref does not resolve at all (no such ref) → `true`.
2. Target is not a git repository at all → `true`.
3. `main` resolves fine, path genuinely absent → `false` (the one case
   that must still read absent).
4. `main` resolves fine, path genuinely present → `true`.

## Non-vacuity (verified, not asserted)

Reverted the fix locally (`catch { return false; }`) and re-ran: cases 1
and 2 above FAIL exactly as expected (`false !== true`); cases 3 and 4
still pass (they were never exercising the bug). Restored; all 20 tests
in the file pass again.

## Self-audit correction

The first commit attempt was refused by `check_property_suite_drift.sh`
(BL-1092's live-corpus guard): the new tests' `gitFixture()` called
`git init` directly, violating BL-1039's "no unit-lane test creates a
git repository of its own" contract. Fixed by switching to the shared
seeded template (`copySeededRepoInto`, `./helpers/sharedRepoFixture`,
the same convention `bl1039SharedRepoFixture.property.test.js` itself
documents) - the template already IS the genuine-absence/genuine-
presence shape (branch "main", one commit); the no-main-ref cases
rename that branch away (an ordinary git operation on the COPY, not a
second repository creation) rather than `git init`-ing a differently-
named branch. Re-verified: 20/20 pass, non-vacuity re-confirmed (revert/
restore), and `bl1092RepoCreationByBehaviour.property.test.js` (the
guard itself) now passes clean.

## Verification

- `npx vitest run test/nightClosingCeremonyLive.test.js test/nightClosingCeremonyRun.test.js`:
  42/42 pass.
- `npx vitest run --config vitest.properties.config.mjs test/bl1092RepoCreationByBehaviour.property.test.js test/bl1039SharedRepoFixture.property.test.js test/bl1393OneCeremonyEverySleep.property.test.js test/bl1640SleepDeadlinesAndCeilingInvariants.property.test.js test/bl1641EnsureBriefingInvariants.property.test.js`:
  13/13 pass (unchanged files, re-run for safety since this parcel touches
  the same module).
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1641's own feature:
  4/4.
- `npm run compile`: clean.

## Not touched (per the bounce's own scope)

Every other check the architect's Article 4.4 inventory ran clean
(`documenterCommitIsPureAdd`, `banked_briefing_lib.bb`/
`compose_banked_briefing_cli.bb`, the BL-658 scenario-04 retirement, the
dependency gate, the shell test self-audit fix) - none of that is
touched by this fix.
