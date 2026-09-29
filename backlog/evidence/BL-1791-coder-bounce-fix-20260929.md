# BL-1791 — coder bounce-fix evidence, 2026-09-29

## D1 (cleaner bounce, BL-1791-bounce-20260929.md) — fixed

Case 04 of `test_openrouter_provider_support.sh` reads a real,
uncommitted `.swarmforge/model-factory/assignment.json` in whatever
worktree runs it (here: this worktree's own live cleaner-seat runtime
state, which pinned `documenter` to `claude-sonnet-5`), because
`resolve_role_model` → `model_factory_cli.bb`'s `factory-state-dir`
defaults to this repo's real state dir when `MODEL_FACTORY_STATE_DIR` is
unset. Fix: export `MODEL_FACTORY_STATE_DIR="$ROOT4/.swarmforge/model-factory"`
around case 04's `zsh -c` block — the cleaner's own remediation pointer,
mirroring `test_pack_staffing_gate.sh`'s `MODEL_STEWARD_STATE_DIR`
isolation for the sibling store. No `swarmforge.sh` edit (the ticket's
own FIRM invariant, still held).

Cases 01–03 need no such isolation (per the cleaner's own note): none of
them asserts on a role's resolved *model* (only membership/first-party-
vs-OpenRouter routing), so they never reach `resolve_role_model`'s
overlay read.

## Verification

- `bash swarmforge/scripts/test/test_openrouter_provider_support.sh`, run
  twice: both runs print all 6 PASS lines and "All BL-523 OpenRouter
  provider-support tests passed." (exit 0).
- `node specs/pipeline/cli.js specs/features/BL-1791-the-openrouter-provider-tests-fixture-names-no-qwen-slug-on-an-openrouter-role.feature`:
  2 of 2 (scenario 02 drives the real script end to end, so it is the
  same evidence as the direct run above).
- `git diff main...HEAD --name-only` (this parcel, both commits
  combined) still names only: the fixture shell script, the step
  handler, and evidence — `swarmforge.sh` absent, per the invariant.

## Invariant re-check

Unchanged from the original commit's own check: `swarmforge.sh` is not
in this parcel's diff; the BL-1328 qwen-cloud-before-OpenRouter
precedence is untouched.

By coder.
