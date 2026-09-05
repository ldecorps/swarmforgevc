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
| Red (non-allowlisted failure, clears on re-run alone) | Commit allowed; load flake recorded (BL-1407, below) |
| Red (any non-allowlisted failure that still fails alone) | Commit blocked; output names unallowlisted files; full suite output retained (BL-1275, below) |
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

**A non-allowlisted refusal retains its full suite output (BL-1275).** Until
this ticket the run was captured to a `mktemp` file, echoed to stderr, and
deleted — the only surviving copy of the evidence a refusal was reached from
was terminal scrollback, and twice that decided whether an investigation was
possible at all (a retained log split one vague report into four distinct
mechanisms on 2026-08-22; a swept one left a rejection unadjudicated on
2026-08-29). On a non-allowlisted red the guard now copies the run's output
to `.swarmforge/property-guard-refusals/refusal-<index>-<stamp>.log` and
names that path in the refusal message
(`property-suite-guard: refusal output retained at <path>`). One file per
refusal — four different files refused five commits in a single shift on
2026-08-29, and a fixed name would have kept only the last, precisely the
one that was not the open question. Retention is bounded to the 20 most
recent refusals (`SWARMFORGE_PROPERTY_GUARD_REFUSAL_KEEP` for tests only —
it changes how many are kept, never whether a commit is refused), and the
directory writes its own `.gitignore` of `*` so nothing under it ever
becomes a commitable artifact. A green run or an allowlisted-standing-reds
run (BL-1175) retains nothing — only a refusal does.

**A non-allowlisted red is re-run once, alone, before it refuses (BL-1407).**
The full 316-file run shares a fork pool (BL-1348/BL-1349 describe it as
mis-sized) where a file can go red only under load — green run alone, red
under the full pool — and until this ticket that refused a commit exactly
like a genuine regression: on 2026-09-04 one approved parcel was refused
five times across 2.5 hours, a different unrelated file each time, none of
them touched by the commit. Every non-allowlisted failing file from the
full run is now re-run once, alone, via `npx vitest run --config
vitest.properties.config.mjs <file>`, sequentially, under a **shared**
wall-clock ceiling (`SWARMFORGE_PROPERTY_RERUN_CEILING_SECONDS`, default
180s, total across all files — a file that has no budget left when its
turn comes counts as still-failing, never as a pass). A file that passes
alone is a load flake: the commit is allowed and the flake is recorded as
one JSON line in `.swarmforge/property-flakes/<YYYY-MM>.jsonl` (file,
commit, whether this commit's staged diff touched that file, and a
retained-output pointer — "not retained until BL-1275", since a
flake-cleared run is never a refusal and BL-1275 only retains refusal
output). A file that still fails alone is refused exactly as before,
naming the file. Allowlisted files (BL-1175) are never re-run.

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
