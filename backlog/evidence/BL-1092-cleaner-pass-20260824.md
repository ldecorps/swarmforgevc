# BL-1092 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `2b4dc35fb7` (repo-creation guard discovers same-file
git-spawning wrappers under any name; bare `git(` + string-spawn shapes
unchanged) into `swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 2b4dc35fb7 HEAD`.

Parcel surface:
- `extension/test/helpers/repoCreationGuard.js`
- `extension/test/repoCreationGuard.test.js`
- `extension/test/bl1092RepoCreationByBehaviour.property.test.js`
- `specs/pipeline/steps/bl1092RepoCreationByBehaviourSteps.js`
- `specs/pipeline/steps/index.js` (register wiring)
- ticket paused → active

## Checks run

1. **Helper unit** —
   `npx vitest run test/repoCreationGuard.test.js`: 21/21 pass
   (includes lane-level `findRepoCreations` empty corpus + BL-1092 cases).
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1092-the-repo-creation-guard-keys-on-a-wrapper-name.feature`:
   8/8 pass. Required wiring: steps in `index.js`.

## Cleanup performed

- Restored load-bearing BL-1032 comments on whole-line string strip and
  `SELF_EXEMPT` (tip had dropped them while adding BL-1092 discovery).
- Steps: situation fixtures via lookup table instead of if/else chain.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1092-the-repo-creation-guard-keys-on-a-wrapper-name`.

By cleaner.
