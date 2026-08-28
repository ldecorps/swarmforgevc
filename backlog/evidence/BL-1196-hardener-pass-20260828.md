# BL-1196 hardener pass — 2026-08-28

Merged architect handoff `b484b7cf1c` (clean pass). No conflicts. This is
the prevention half of the `swarmforge-hardender` branch-corruption
incident (memory: an ambient `GIT_DIR`/`GIT_WORK_TREE` silently redirects
any unguarded test `git()` spawn onto whatever repo those vars name) — a
genuinely safety-critical structural fix (one setup-file strip, registered
in both `vitest.config.mjs` and `vitest.properties.config.mjs`, closing
the door for all ~60 existing local `git()` helpers and any future one).

## Scope note

`extension/src/**` is untouched (pure test-infrastructure fix); the
mutation cooldown gate's `file_age_days` reading for
`gitEnvGuard.js` is a nonsensical ~20693 days (the file is brand new,
untracked-at-mint edge case in the gate's git-log lookup) — moot either
way, since this file is test-helper code, never in Stryker's `--mutate
out/**/*.js` scope. Hardening below is hand-verification plus the
standing whole-tree guards, matching how test-infrastructure-only parcels
are hardened elsewhere this session.

## A real gap found: this parcel's OWN new test violates a standing guard

Since the parcel touches `extension/test/`, ran the full non-property
`*Guard*.test.js` suite (per the 2026-08-19 standing rule). Found a
GENUINE, parcel-introduced violation neither architect nor cleaner's
review caught: `test/repoCreationGuard.test.js`'s `BL-1039 D4` scan
flagged the new `gitEnvGuard.test.js` for creating git repositories
directly (`git init`) instead of using the shared seeded fixture
(`sharedRepoFixture.js`).

**Checked whether the shared fixture actually fits before flagging it as
a real defect** (not a rubber-stamp exemption): it does not.
`copySeededRepoInto`'s template always carries one pre-existing 'init'
commit, and this test's own "the decoy repository gains no new commits"
assertion requires the decoy to show a LITERALLY EMPTY `git log --oneline
--all` — a copy from the shared template would already show that one
seeded commit, failing the assertion on correct code. The guard's own
`BL-1039-EXEMPT: <reason>` escape hatch exists for exactly this shape
(a genuine need for a from-scratch, provably-empty repo, not the
repeated-per-scenario cost the guard was built to eliminate — this file
pays `git init` exactly twice, no commits beyond the one it itself
makes). Added the exemption comment with that reasoning. Confirmed the
guard passes: 21/21 in `repoCreationGuard.test.js`.

## A false alarm, ruled out and recorded (not fixed, because there was nothing to fix)

Suspected a second gap, matching this session's BL-1204 lesson (a throw in
an intermediate acceptance step before the terminal step's own
try/finally cleanup): scenario 02's step sequence sets real
`GIT_DIR`/`GIT_WORK_TREE`, and only the LAST step restores them, with two
steps in between (a spawn, an assertion) that could each throw.

Implemented a fix (try/catch + shared `restoreEnv()` in both intermediate
steps) and wrote a direct in-process probe
(`runScenario` against a hand-built scenario object, mutating the
assertion step to force a throw) to verify it closed a real leak — **it
did not, because there was no leak to close**: the very step that sets
`GIT_DIR`/`GIT_WORK_TREE` (`the process environment's GIT_DIR points at
the decoy repository`) calls `stripAmbientGitDirRedirect()` at the END of
that SAME step, before any later step runs, so the "corruption window" I
was checking for never exists in this control flow at all. Confirmed by
running the identical probe against the git-show'd HEAD (pre-hardener)
version of the file with the same forced throw: `GIT_DIR`/`GIT_WORK_TREE`
were `undefined` after the throw there too — no difference between "my
fix" and "no fix," because both were protecting against a risk that isn't
present. **Reverted the change** (`git checkout --`) rather than leave in
unneeded, misleading-comment code for a gap that does not exist — matches
this ticket's own "no unjustified changes" discipline. Recording the
investigation here so a future pass does not re-walk the same dead end.

## Verification

- `npm run compile`: clean.
- `vitest run test/gitEnvGuard.test.js test/sampleResourcesCli.test.js
  test/repoCreationGuard.test.js`: 34/34 pass.
- `run_acceptance.sh` on the BL-1196 feature, 2 consecutive runs: 2/2 pass
  every run.
- Standing whole-tree guards: after the exemption-comment fix, back to
  the same 4 pre-existing failures as every prior pass this session
  (`liveRepoDerivationGuard`, `tmpDirMigrationGuard`, `tempDirTrapGuard`,
  `socketFixtureShortRootGuard`), none naming any BL-1196 file.

## Cleanup

No orphaned `node --test`/`stryker` processes at handoff. Deleted every
scratch probe file this pass created (`/tmp/bl1196_leak_probe.js` and its
`.bak` variants).

By hardener.
