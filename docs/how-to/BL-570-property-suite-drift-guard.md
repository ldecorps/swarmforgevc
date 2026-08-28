# Pre-commit property-suite drift guard (BL-570)

## The gap

`npm run test:properties` is excluded from unit/coverage/mutation/CRAP and
from CI. Enforcement lived only in architect/hardener/QA prompts, so an
out-of-band commit could leave a property red until someone ran the suite by
hand (e.g. `d63e80320` on 2026-07-22).

## What changed

`swarmforge/scripts/check_property_suite_drift.sh` is wired from the shared
`swarmforge/git-hooks/pre-commit` (same pattern as `check_commit_size.sh`).

| Staged path | Guard |
| --- | --- |
| `extension/src/*` or `*.property.test.js` | Runs `npm run test:properties` |
| Docs, backlog YAML, etc. | Skips |

| Suite state | Result |
| --- | --- |
| Green | Commit allowed |
| Red (all failures explicitly allowlisted — BL-1175) | Commit allowed; `allowlisted-standing-reds` marker |
| Red (any non-allowlisted failure) | Commit blocked; output names unallowlisted files |
| Red (unparsed failure output) | Commit blocked |
| Toolchain missing (`node_modules` / npm / exit 127) | Warn + allow (fail open) |
| Mid-merge byte-identical import (BL-1121) | `skip-reconcile-import` + allow (standing recipe; not the env override) |
| `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` | Warn + allow (recovery override only — never the standing recipe) |

Standing allowlist: `swarmforge/scripts/property_suite_standing_allowlist.tsv`
(one row per known red with `allowlist` or `fix` disposition and rationale).

The guard also reports its BL-1124 shared-repo canary verdict on every exit
path of the run it guards — including the guard itself being killed
mid-run — and never leaves a suite process running once it exits. Detail:
`docs/how-to/BL-1124-property-suite-fixtures-must-not-mutate-shared-main.md#canary-fires-on-every-exit-path-including-a-kill-bl-1202`
(BL-1202).

## Operator note

Fix red properties before committing source/property changes, or set the
override only for a deliberate recovery commit (same escape hatch expedite
needs when machinery is broken). Hook install remains
`git config core.hooksPath swarmforge/git-hooks` via launch.

Acceptance:
`specs/features/BL-570-property-suite-drift-guard.feature`

Related: commit-size guard (`docs/how-to/BL-105-history-strip.md`).
Standing-red allowlist detail:
`docs/how-to/BL-1175-property-suite-standing-reds-block-unrelated-commits.md`.
