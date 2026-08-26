# BL-1103 — hardener pass, 20260824

## Inbound

Merged architect `a7884358d3` into `swarmforge-hardender`.

## Scope

Shared `bounded_run_lib.bb` / `run-bounded!`: setsid + `kill -KILL -- -<pgid>`,
file-backed stdout/err (no deref on timeout). Callers: expedite_cli,
babysitter_check.

## Host / cooldown

| File | Decision |
|---|---|
| `bounded_run_lib.bb` | **run** |
| `expedite_cli.bb` / `babysitter_check.bb` | **skip-cooldown** (fresh) |

No Stryker (babashka). Surgical on the shared lib.

## BL-113 Gherkin (soft)

**inapplicable** — feature has no Scenario Outline example table (soft
mutates example cells only). Acceptance scenarios still green 3/3.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| drop setsid wrap | killed |
| drop `--` before `-<pgid>` | killed |
| kill bare pid (not process group) | killed |
| never report timed-out? | killed |
| use :string pipes instead of files | killed |

Survivors: 0.

## Verification

- Acceptance 3/3; `bounded_run_lib_test_runner.bb` ALL PASS

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1103-one-shared-bounded-runner`.

By hardender.
