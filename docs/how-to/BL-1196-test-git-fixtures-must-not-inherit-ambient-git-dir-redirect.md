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
| `swarmforge/scripts/check_property_suite_drift.sh` | `unset -v GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE` right before it launches the suite (or a test-injected command) — the shell-fixture enforcement site a Vitest `setupFile` can never reach (added 2026-08-28, see amendment below). |

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

## Amendment (2026-08-28): `GIT_INDEX_FILE` and a second enforcement site

The original fix stripped only `GIT_DIR`/`GIT_WORK_TREE`. The same day, a
second, related incident (see
`backlog/evidence/hardener-noticed-coder-process-explosion-20260828.md`)
traced the actual root cause: **git itself**, not a stray operator shell,
exports `GIT_DIR`/`GIT_INDEX_FILE` (both absolute, `GIT_WORK_TREE` unset)
into every hook it runs for a commit made from a linked worktree.
`GIT_INDEX_FILE` is the only one of the three set at all in the
master-checkout presentation of the same defect.

Two changes, per the original doc's own stated widen-only-if-implicated
condition:

1. `stripAmbientGitDirRedirect()` now also deletes `GIT_INDEX_FILE`.
2. A **second enforcement site**: `check_property_suite_drift.sh` (the
   suite launcher a pre-commit hook invokes) now runs `unset -v GIT_DIR
   GIT_WORK_TREE GIT_INDEX_FILE` immediately before launching the suite (or
   a test-injected command). A Vitest `setupFile` only covers code running
   inside Vitest — it cannot reach a shell fixture the suite shells out to
   (mkdtemp + `git init` + `git commit`), which is exactly the vector this
   closes.

Confirmed non-vacuous the strong way: reverting the shell-launcher scrub
reproduced real damage (the outer commit hung on lock contention from a
corrupted worktree) rather than a clean assertion failure.

## What this does not cover

- The shell-lane equivalent for OTHER shell/Babashka test fixtures (not the
  suite-launcher enforcement site added above) — tracked separately as
  BL-1200.
- Other `GIT_*` plumbing variables beyond `GIT_DIR`, `GIT_WORK_TREE`, and
  `GIT_INDEX_FILE` (e.g. `GIT_OBJECT_DIRECTORY`, `GIT_COMMON_DIR`) are not
  stripped — widen only if a future incident actually implicates one, per
  this ticket's own precedent.

## Acceptance

`specs/features/BL-1196-test-git-fixtures-must-not-inherit-ambient-git-dir-redirect.feature`
