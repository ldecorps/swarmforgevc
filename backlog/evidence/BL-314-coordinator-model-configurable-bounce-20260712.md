# BL-314 bounce evidence — 2026-07-12

## Failing command

```sh
env -u SWARMFORGE_CONFIG ./specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-314-coordinator-model-configurable.feature
```

## Commit hash

`923ca4c942` (coder's BL-314 commit), merged into QA's worktree together
with the specifier's later `1a41150` (authored the missing
`specs/features/BL-314-coordinator-model-configurable.feature`, itself
merged into main at `09aa035`) — both present at the tip tested.

## First error excerpt

```
# Subtest: a pack's declared coordinator model/effort are applied
not ok 1 - a pack's declared coordinator model/effort are applied
  error: Scenario "a pack's declared coordinator model/effort are applied": no step handler matched "Given a pack config declares coordinator_model claude-sonnet-5 and coordinator_effort high"

# Subtest: absent coordinator config falls back to a Sonnet-tier default
not ok 2 - absent coordinator config falls back to a Sonnet-tier default
  error: Scenario "absent coordinator config falls back to a Sonnet-tier default": no step handler matched "Given a pack config declares neither coordinator_model nor coordinator_effort"

# Subtest: a pack may still explicitly opt the coordinator into Opus
not ok 3 - a pack may still explicitly opt the coordinator into Opus
  error: Scenario "a pack may still explicitly opt the coordinator into Opus": no step handler matched "Given a pack config declares coordinator_model claude-opus-4-8"

# Subtest: the coordinator still cannot be declared as a window line
not ok 4 - the coordinator still cannot be declared as a window line
  error: Scenario "the coordinator still cannot be declared as a window line": no step handler matched "Given a pack config declares a window line for the coordinator role"

1..4
# tests 4
# pass 0
# fail 4
```

## Failure class

`acceptance`

## Expected vs observed

Expected: `run_acceptance.sh` against `specs/features/BL-314-coordinator-
model-configurable.feature` exercises the real `coordinator_config_lib.bb`/
`coordinator_config_cli.bb`/`swarmforge.sh` wiring end-to-end (the same
"REAL compiled producers against a fixture" posture every other ticket's own
step file uses — e.g. `backlogDepthCapOverrideSteps.js`,
`operatorSeedRaceLaunchGraceSteps.js`) and all 4 scenarios pass, per BL-112's
mandate that QA's final gate is this executable acceptance run, not a manual
eyeball pass against the ticket's prose.

Observed: all 4 scenarios fail immediately with "no step handler matched" —
no file under `specs/pipeline/steps/` registers a handler for any of this
feature's Given/When/Then text, and `specs/pipeline/steps/index.js` has no
entry requiring one. Root cause (not a blame assignment, a sequencing fact):
the coder built and delivered BL-314 while the ticket's own
`specs/features/BL-314-coordinator-model-configurable.feature` did not yet
exist in git history (correctly flagged in the coder's own commit message),
so no step file could be written against it at build time; the specifier
authored the feature file afterward, but no step handlers were added
alongside it. The existing shell tests
(`test_coordinator_config_pack_override.sh`,
`test_coordinator_config_cli.sh`) already cover every scenario in spirit
against the real `swarmforge.sh`/`coordinator_config_lib.bb`/
`coordinator_config_cli.bb` — this bounce is about wiring the SAME real
assertions into the mandatory Gherkin acceptance run, not about finding a
new behavioral gap.
