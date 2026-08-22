# BL-631 — cleaner review, one bounce, complete inventory

Reviewing commit `cf2c2ad96a` (coder). Checklist run: compile (clean, no
`extension/src` changes), the new BL-631 acceptance feature (17/17 pass),
every `swarmforge/scripts/test/babysitter*` runner, and jscpd over the new
step-handler file.

## D1 — CONFIRMED — a pre-existing, unmodified standing test regresses

`swarmforge/scripts/test/test_babysitter_check.sh` scenario A ("fully green
snapshot — quiet") now fails:

```
FAIL: A: expected all-clear line; got: 2026-08-19T09:10:18Z UNAVAILABLE
[pipeline-code-on-main] pipeline-code-on-main check unavailable this sweep -
the swarmforge-QA ref could not be resolved (fails closed, never reads as
clean)
```

Reproduced both ways:
- On `cf2c2ad96a` (and on the cleaner-merged tip): `bash
  swarmforge/scripts/test/test_babysitter_check.sh` fails at scenario A.
- On the immediate parent (`d2ee8d99c`, via a throwaway `git worktree add
  /tmp/bl631-check d2ee8d99c`): the identical script's all 9 scenarios
  (A-I) pass, `ALL PASS`.

Root cause: `test_babysitter_check.sh`'s `make_root()` builds a bare tmp
directory (`.swarmforge/`, `backlog/active/`) with no `git init` at all —
every check before this ticket was git-independent. BL-631's new
`check-pipeline-code-on-main` is wired unconditionally into
`assemble-findings`, and per the ticket's own invariant 3 ("an unresolvable
swarmforge-QA ref is UNAVAILABLE, never a silent clean sweep") it correctly
fails closed when it cannot resolve `swarmforge-QA` — which it never can in
a non-git fixture root. That invariant is right for production; the
regression is that the coder's own parcel never updated the one standing
integration test whose fixture assumption ("no check needs git") the new
check just broke.

This is not a design flaw in BL-631's own dedicated acceptance suite — all
17 of its own scenarios pass, including the equivalent
"UNAVAILABLE-not-all-clean" case (scenario 08) against a purpose-built git
fixture. The gap is narrowly in the untouched sibling file.

Confirmed NOT a wider spread: scenarios B–I in the same script assert via
substring `grep -q` on their own specific finding text (e.g. `CRIT
[failed-box]`), which an extra unrelated UNAVAILABLE line does not disturb;
only scenario A's stricter "OK all checks green" (i.e., *zero* findings)
assertion is broken. (The script uses `set -e` and exits at the first
`fail`, so B–I were not re-verified past A in this run; the reasoning above
is by inspection of each assertion's grep target, not by observation of a
full run.)

Remediation pointer: `make_root()` (or scenario A specifically) needs a
resolvable `swarmforge-QA` context — a minimal `git init` fixture with a
`swarmforge-QA` branch, following the same pattern the new BL-631 feature's
own step handler (`specs/pipeline/steps/bl631BabysitterDetectsPipelineCodeOnMainSteps.js`)
already establishes for its scenario 08 — or an explicit, narrow opt-out for
this one script's non-git fixture if a git-backed fixture is judged the
wrong fix. Either way this is coder-owned: it is the coder's own new check
that broke the coder's own sibling test file, unrelated to cleaner's own
domain (DRY/CRAP/mutation/structure).

## Checks run and their result

- `npm run compile` (extension/): clean — no `extension/src` files in this
  commit's diff.
- `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`: PASS.
- `bb swarmforge/scripts/test/babysitter_lib_test_runner.bb`: PASS.
- `bb swarmforge/scripts/test/babysitter_assess_lib_test_runner.bb`: PASS.
- `bb swarmforge/scripts/test/babysitterd_freshness_lib_test_runner.bb`: PASS.
- `bash swarmforge/scripts/test/test_babysitterd_lifecycle.sh`: PASS (all 8).
- `bash swarmforge/scripts/test/test_babysitter_check.sh`: **FAIL at
  scenario A** — see D1.
- `./specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-631-babysitter-detects-pipeline-work-on-main.feature`:
  PASS (17/17).
- `npx jscpd specs/pipeline/steps/bl631BabysitterDetectsPipelineCodeOnMainSteps.js`:
  one 6-line/67-token clone across two Outline-scenario git-fixture setups —
  ordinary per-scenario fixture-init boilerplate, not meaningful duplication;
  not blocking, noted only for completeness (no separate item).

No other defect found. Nothing was cleared for cleanup work on top of this
commit since the regression must be fixed at its source (the new check's
integration wiring / the untouched test file), not patched around here.
