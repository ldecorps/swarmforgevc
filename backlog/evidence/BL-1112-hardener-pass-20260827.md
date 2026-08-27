# BL-1112 — hardener pass — 20260827

## Inbound

Architect `19d700ad8d` after cleaner `00f972b964` — GIT_DIR fixture isolation
for `sampleResourcesCli` and APS step handlers.

## Merge note

Merged `19d700ad8d` with `--no-ff`. Resolved `index.js` conflict — `bl1187`
after `bl1169`; `bl1171` at tail.

## Hardening

| Gate | Result |
|---|---|
| Acceptance | **6/6** (`BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox.feature`) |
| Unit | **30/30** (`sampleResourcesCli.test.js` 9/9, `strykerSandboxSiblingsLib.test.js` 21/21) |
| Gherkin soft | **pass** (skipped=4 — prior manifest stamp valid) |
| Cooldown | `strykerSandboxSiblingsLib.js` **skip** (2.99d); prior surgical sweep still load-bearing |

## Hand-authored surgical (`sharedRepoFixture.js` gitIn env)

| Mutant | Result |
|---|---|
| drop GIT_DIR unset | killed |
| drop GIT_WORK_TREE unset | killed |
| use raw process.env in gitIn | killed |

Survivors: 0.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox`.

By hardender.
