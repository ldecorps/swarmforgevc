# BL-640-constitution-reference-amendments-have-no-delivery — architect pass (round 2)

Round-1 bounce: `backlog/evidence/BL-640-constitution-reference-amendments-have-no-delivery-bounce-20260818.md`
(D1 fixture isolation, D2 local-main-only freshness). Coder fix reviewed:
`5a8c134cc` (forwarded unchanged by cleaner via merge `2a9f250f3c`).

## D1 remediation verified

`test_reference_freshness_guard.sh` no longer asserts on
`ready_for_next_task.sh`'s own dispatch output. `roles.tsv` now names an
unrecognized receive-mode (`guard-boundary-only`), so `run-dispatch!` fails
closed with its own `INVALID_RECEIVE_MODE` before ever exec'ing the real
`.sh` wrapper — the exec that was escaping into the real repo's cwd is now
structurally unreachable in the test. Scenario 01 is proven by two
guard-attributable signals instead: no `STALE_REFERENCE_ELABORATION` (the
guard did not refuse) and `INVALID_RECEIVE_MODE` reached (control passed
through the guard to dispatch). Ran the fixture 3 consecutive times: all
green, all 4 markers (02, 02-dequeue, 01, 02-origin-ahead) PASS every run.

## D2 remediation verified

`freshest-main-ref` added: `git rev-list --left-right --count
main...origin/main`, reads `origin/main` when it is ahead of local `main`,
else `main`; falls back to `main` on any git error (no origin configured,
tie). `main-reference-shas` now resolves against this ref instead of a
hardcoded `main`. New fixture scenario constructs a real bare origin +
second clone standing in for QA's push-to-origin path, proving a worktree
byte-identical to (stale) local `main` still refuses once `origin/main` has
moved further ahead.

## Full re-verification

- `bash swarmforge/scripts/test/test_reference_freshness_guard.sh` × 3 runs:
  ALL PASS every time (previously deterministic FAIL on scenario 01).
- `node specs/pipeline/cli.js specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
  → **5/5 PASS** (previously 4/5, scenario 1 failing).
- `bb swarmforge/scripts/test/reference_freshness_lib_test_runner.bb` →
  `ALL PASS: reference_freshness_lib.bb`.
- `bb swarmforge/scripts/test/bl640_reference_freshness_property_runner.bb`
  → `ok` (unchanged pure-logic layer, D2 lives entirely in the IO wrapper).
- `bb swarmforge/scripts/test/bl640_prompt_stability_check.bb` → both
  scenarios (04/06) PASS, no compose regression.
- **Dependency-gate hard gate** (BL-259): N/A — both changed files
  (`ready_for_next.bb`, `test_reference_freshness_guard.sh`) are under
  `swarmforge/scripts/`, none under `extension/src`/`extension/media`.
- **Co-change report**: run against both changed files. Same pre-existing
  hub-file "SUSPECTED COUPLING" as round 1 (the handoff-family scripts,
  `specs/pipeline/steps/index.js`) — nothing new introduced by the fix.
- **Fixture hygiene**: the new origin/clone/worktree fixtures all go through
  `register_tmp_dir` (the EXIT-trap registry, BL-459/BL-801) — no bare
  `mktemp -d` left unregistered.
- **Architecture boundary rules**: N/A — zero files under `extension/`.

Both D1 and D2 are closed. Ticket invariant (BL-654) property coverage
unaffected and still green. Forwarding to hardener.

By architect.
