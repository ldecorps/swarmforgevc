# BL-577 — hardener PASS

**Verdict:** PASS -> forward to documenter.

Reviewed commit: architect PASS `eebf6002d5` (BL-577 architect pass evidence,
supersedes the earlier architect forward `df1d94cdfc` per the architect's own
note — `df1d94cdfc` is a strict ancestor of `eebf6002d5`), merged into
`swarmforge-hardener`.

## Cooldown gate (BL-149)

`mutation_cooldown_gate.bb` against every changed production file:
- `swarmforge/scripts/handoffd.bb` — `skip-cooldown` (0.15 days old).
- `specs/pipeline/steps/index.js` — `skip-cooldown` (0.08 days old).
- `swarmforge/scripts/flow_watchdog_lib.bb` — `run` (pre-existing file from
  the coder parcel, git-age well past cooldown).
- `specs/pipeline/steps/bl577FlowWatchdogParcelAgeInvariantSteps.js` — `run`.

No language mutation tool applies to any of these regardless of gate decision:
this parcel touches only `.bb` (Babashka) and a plain step-handler `.js` file
under `specs/pipeline/steps/`. Per engineering.prompt, `.bb` mutation/CRAP/DRY
tooling is not wired (BL-472) — the real gate is the project's own `.bb` unit
suite. Stryker's `--mutate` scope is `out/**/*.js` (compiled `extension/src`
TypeScript) — `specs/pipeline/steps/*.js` is outside that scope entirely, so
no JS mutation run applies either.

## `.bb` unit suite (the real gate for this parcel's Babashka code)

- `bb swarmforge/scripts/test/flow_watchdog_test_runner.bb` -> `ALL PASS`.
- `swarmforge/scripts/test/test_handoffd_flow_watchdog_wiring.sh` -> both
  assertions pass against the real daemon (warn-tier state entry recorded;
  Telegram OPERATOR-topic alarm emitted naming role + rotate verb).

## CRAP / DRY — not applicable

`npm run crap` / `npm run dry` (jscpd) both scope to `extension/src/*.ts`.
None of this ticket's changed files (`swarmforge/scripts/*.bb`,
`specs/pipeline/steps/*.js`) fall under that path — nothing to run or fix.

## Gherkin acceptance mutation (BL-113, soft) — the primary hardening pass

`specs/features/BL-577-flow-watchdog-parcel-age-invariant.feature` has 4
`Scenario Outline:` blocks (of 13 total scenarios); ran
`run_gherkin_mutation.sh` at `soft` level, `steps/index.js` as the runner.

Result (embedded manifest, `acceptance-mutation-manifest-begin`/`-end`,
all 4 outline scenarios present with zero survivors and zero errors — per
BL-502, only clean scenarios are written to the manifest, so this is direct
proof none of the 4 outlines had a surviving mutant):

| Scenario | Total | Killed | Survived | Errors |
|---|---|---|---|---|
| an over-threshold parcel ... alarms while every liveness signal reads green | 3 | 3 | 0 | 0 |
| a parcel that progresses never alarms again | 3 | 3 | 0 | 0 |
| coverage spans master-resident and worktree mailboxes, new and in_process | 4 | 4 | 0 | 0 |
| the 2026-07-23 incidents replayed as fixtures each alarm within one sweep | 6 | 6 | 0 | 0 |

16/16 mutants killed across all four outlines (verb typos, role/mailbox-name
typos, incident-fixture-name typos, example-value casing) — every mutated
example value is load-bearing. No rework needed; committed the resulting
`mutation-stamp` + manifest header update to the feature file (no other
diff).

## Acceptance verification

`specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-577-flow-watchdog-parcel-age-invariant.feature` — 22/22
scenarios pass (all 13 Gherkin scenarios incl. outline expansions).

## Process hygiene

No orphaned `node --test` / `stryker` / `gherkin-mutator` processes left
running after any run (`pgrep -fl` scoped to this worktree clean before and
after). Mutation working directory (`tmp/bl577-gherkin-mutation`) removed
after the run.

## Residual items (carried from architect evidence, non-blocking)

- `flow-watchdog-emit-alarm!`'s outbox-append block is a third verbatim copy
  in `handoffd.bb` — folding into `daemon_alarm_lib.bb` is a worthwhile
  follow-up, not this ticket's work.
- No `.bb` property-test harness exists — tracked alongside the `.bb`
  mutation/CRAP/DRY gap (BL-472).

— By hardener.
