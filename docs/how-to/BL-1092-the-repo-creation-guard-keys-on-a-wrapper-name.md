# Repo-creation guard keys on behaviour, not wrapper name (BL-1092)

## The gap

BL-1039’s unit-lane guard blocked `git init` by matching a literal `git(`
wrapper call. Renaming the helper (`runGit`, `g`, …) made creations invisible
while the invariant still looked enforced. The gap was latent (live corpus used
`git`), but the naming convention was unenforced.

## What changed

`repoCreationGuard.js` still matches inline/string/`git(` shapes. It also
discovers **same-file** helpers whose bodies spawn `git`, then matches
`<name>(…, ['init'`. Non-git spawners (e.g. `tar`) stay unflagged.

Unchanged:

- Whole-line string literals (test data) stripped before scan
- Shared fixture `gitIn` / self-exempt paths
- `BL-1039-EXEMPT:` reasons

## Operator note

Prefer the shared seeded fixture. If you must `init`, keep a real
`BL-1039-EXEMPT:` reason naming the repository shape. Renaming a local git
wrapper no longer hides an `init`.

Acceptance:
`specs/features/BL-1092-the-repo-creation-guard-keys-on-a-wrapper-name.feature`

Related: `docs/reference/BL-1039-shared-git-repo-fixture.md`.
