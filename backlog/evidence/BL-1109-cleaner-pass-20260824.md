# BL-1109 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `ec9bb10e83` (live idle-owner in_process counts as starved
motion; shared stuck/starved gather glob; CRIT copy names claim counts) into
`swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor ec9bb10e83 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`:
   ok.
2. **Babashka property** —
   `bb swarmforge/scripts/test/babysitterd_sweep_lib_property_runner.bb`: ok.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1109-babysitter-starved-ignores-idle-owner-in-process.feature`:
   6/6 pass.

## Cleanup performed

- `motion-in-process?`: drop redundant `(boolean …)` — `(not abandoned?)`
  already treats nil/false as live motion (gather never marks abandoned).

## Findings beyond that

NONE. Glob shared with stuck-in-process; CRIT mailbox clause never says
"zero … parcels" when claims were gathered; step registration sits next to
BL-807.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1109-babysitter-starved-ignores-idle-owner-in-process`.

By cleaner.
