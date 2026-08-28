# Test-suite `git()` fixtures must not inherit an ambient GIT_DIR/GIT_WORK_TREE redirect (BL-1196)

## Incident class

An ambient `GIT_DIR`/`GIT_WORK_TREE` exported by the host shell (or leaked in
from a linked worktree's hook environment) silently redirects **any** `git`
spawn onto whatever repo those vars name, regardless of the spawn's own
`cwd`. `sharedRepoFixture.js`'s `gitIn` helper already strips both per-spawn
(BL-1039), but roughly 60 other test files under `extension/test/` define
their own local, unguarded `function git(cwd, args) { execFileSync('git',
args, { cwd, ... }) }` with no env override — any one of those obeys the
inherited redirect instead of its own `cwd`. This is the root-cause class
behind the `swarmforge-hardender` branch corruption
(`backlog/evidence/hardener-branch-corruption-20260827.md`) and a same-day
property-fixture live-repo write. BL-1124 detects the resulting damage after
the fact; this ticket is the prevention half — it removes the precondition
instead of just catching the aftermath.

## What changed

| Piece | Role |
| --- | --- |
| `extension/test/helpers/gitEnvGuard.js` | Exports `stripAmbientGitDirRedirect()` — deletes `GIT_DIR`/`GIT_WORK_TREE` from `process.env` if present; idempotent. |
| `extension/test/helpers/gitEnvGuardSetup.js` | Calls the strip once at module load; registered as a Vitest `setupFiles` entry so it runs before any test in the file that pulls it in. |
| `extension/vitest.config.mjs` | Adds `gitEnvGuardSetup.js` to the unit lane's `setupFiles`, alongside `tmpDirSetup.js` / `envRestoreGuardSetup.js`. |
| `extension/vitest.properties.config.mjs` | Same registration in the property lane — this is where the original leak was reported. |
| `extension/test/gitEnvGuard.test.js` | Unit test on the exported strip, plus an integration-shaped decoy/target repo test proving an inherited `GIT_DIR` no longer hijacks a spawn. |

## Why a central setup file, not a 60-file migration

Editing every existing local `git()` helper only fixes today's known call
sites — the next file that copies the same unguarded shape reintroduces the
gap, which is exactly how this recurred after BL-1124 shipped. Stripping the
two redirect variables once, centrally, before any test file's own top-level
code runs closes the door structurally for every current **and future**
call site with one small, reviewable change. The ~60 existing per-file
`git(cwd, args)` helpers are untouched by design — their shape becomes safe
by construction because `process.env` no longer carries the redirect by the
time they run.

This does not replace BL-1124's post-hoc detector (still a valid second line
of defense) or `sharedRepoFixture.js`'s per-spawn strip (BL-1039) — it is
additive, registered alongside `tmpDirSetup.js` / `envRestoreGuardSetup.js`,
not a substitute for either.

## Scope boundary — `gitEnvGuard.test.js`'s own decoy repos

`gitEnvGuard.test.js`'s integration-shaped test needs two repositories with
provably zero commit history each, to assert "the decoy repository gains no
new commits" as a literal empty `git log`. `sharedRepoFixture.js`'s shared
template always carries one seeded `init` commit, which would break that
assertion even on correct code — so this test creates its own two `git
init` repos directly rather than through the shared fixture, marked
`BL-1039-EXEMPT` in the test file with the reasoning above. This is a scoped
exemption from BL-1039's shared-fixture convention, not a gap in this
ticket's guard.

## What this does not cover

- The shell-lane equivalent (`swarmforge/scripts/test/expedite_fixture.sh`
  and other Babashka/shell test fixtures) is out of scope — tracked
  separately as BL-1200.
- Other `GIT_*` plumbing variables (`GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
  `GIT_COMMON_DIR`, etc.) are not stripped here — only `GIT_DIR` and
  `GIT_WORK_TREE`, the two vars every existing guard in this codebase has
  ever needed to clear.

## Acceptance

`specs/features/BL-1196-test-git-fixtures-must-not-inherit-ambient-git-dir-redirect.feature`
