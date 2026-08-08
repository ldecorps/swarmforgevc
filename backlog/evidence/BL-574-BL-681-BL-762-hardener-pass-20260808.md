# Hardener pass — BL-574, BL-681, BL-762 (2026-08-08)

## Context

Received `merge_and_process architect 1c10e03b4e` (three separate `git_handoff`s
per Article 2.6, one per ticket, all naming the same architect commit). Ancestry
confirmed by the merge itself (`git merge 1c10e03b4e`, clean, no conflicts).

Also drained two QA merge-up notes queued in the same batch ahead of these
three tickets: BL-855 (56ab723e) and BL-619 (b9ee6a69), both `git merge`d
clean with no conflicts. Neither carries functional work of my own — merge-up
only, per constitution 2.5 / role prompt "QA merge-up broadcast": completed,
not forwarded.

## Applicability scan

- No `extension/src/**/*.ts` files touched by this batch (confirmed by
  architect's dependency-gate run and independently re-confirmed here via
  `git diff --stat` across all three tickets' commit ranges). Stryker
  (TypeScript mutation), the CRAP scripts, and jscpd (DRY) are all scoped to
  `extension/src`/compiled `out/**/*.js` per engineering.prompt's Startup
  Tools table — **not applicable to this batch**.
- BL-574, BL-762: Babashka/bash production code. Per engineering.prompt,
  Babashka mutation/CRAP/DRY tooling is not wired (BL-472, deferred) — the
  real gate is the unit-test suite plus, for `Scenario Outline` features,
  the Gherkin soft-mutation wrapper.
- BL-681: pure prose/governance change (constitution Article 5.3 citation +
  step handlers reading real files verbatim). No `Scenario Outline` in its
  feature (plain `Scenario:` only) — Gherkin mutation is inapplicable by
  design, not skipped.

## BL-149 mutation cooldown gate — busy host, deferred

Ran `mutation_cooldown_gate.bb` against every changed production file in the
batch (`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`, macOS `sysctl`/`nproc`
unavailable per the standing rule_proposal workaround):

```
prompt_engine_lib.bb            -> skip-busy
agent_runtime_lib.bb            -> skip-busy
finish_shift_lib.sh             -> skip-busy
lifecycle_matrix.sh             -> skip-busy
stop_ancillary_services.sh      -> skip-busy
finish-shift                    -> skip-busy
bl574PromptEngineFragmentsAdaptersSteps.js -> skip-busy
bl681ConsolidationNeverDropsHumanSentenceSteps.js -> skip-busy
bl762FinishShiftPhonePathSteps.js -> skip-busy
```

`uptime` sampled twice five minutes apart: load averages 10.02/10.41/14.29
and 8.17/9.54/12.96 on 4 cores — consistently at or above the 2.00x-cores
busy threshold. Per the office-hours mutation bypass policy: bypassing the
expensive mutation pass (Gherkin soft-mutation for BL-574's and BL-762's
`Scenario Outline` scenarios; the BL-638 hand-authored surgical sweep for
`.bb`/`.sh` code with no wired tool) on a busy host, rather than stalling
this parcel waiting for a quiet window. Deferred to the next quiet hardener
pass over these same files — not skipped permanently, not waved through as
passed.

## Verification re-run (targeted-test hardening, per bypass policy)

- `bb swarmforge/scripts/test/prompt_engine_fragment_cache_property_runner.bb`
  — 200/200 runs, ALL PROPERTIES HOLD (re-confirmed after merge).
- `bash swarmforge/scripts/test/test_finish_shift_lib.sh` — PASS=11 FAIL=0
  (re-confirmed after merge; no leaked `sleep`/tmux fixtures survived —
  `pgrep -fl 'node --test|stryker'` and `pgrep -afl tmux` checked clean
  afterward, only the live swarm's own repo-socket `swarmforge-coder`
  session present).
- `run_acceptance.sh` for all three feature files: BL-574 9/9, BL-681 3/3,
  BL-762 14/14 — all green, matching the architect's numbers exactly.
- `bash swarmforge/scripts/test/test_prompt_engine_lib.sh` — same 1
  pre-existing failure the architect flagged (`stable prefix under 50KB
  after article splits`, now 65138 chars vs the 51200 cap). Independently
  reproduced on bare `main` (`944afcd7`, no BL-574/681/762 content at all)
  with the identical 65138-char value — conclusively pre-existing and
  unrelated to this batch, not merely unrelated-by-diff-inspection. BL-618
  (`backlog/done/`) fixed this once before; the boot prefix has regrown past
  the cap since. No active/paused ticket currently tracks the regression —
  flagging to specifier/coordinator via `note` (not a bounce: confirmed
  unrelated, not owned by any of these three tickets, and blocking on it
  would stall a clean batch over an unticketed pre-existing defect).

## CRAP / DRY

Not applicable — no `.ts` files in scope for this batch (see Applicability
scan above).

## Conclusion

No survivors to kill this pass (mutation deferred, not run, due to
sustained busy-host signal from the BL-149 gate). All three tickets'
existing test suites (property, exhaustive-matrix, acceptance) re-verified
green post-merge. Forwarding each of BL-574, BL-681, BL-762 to documenter as
its own `git_handoff` per Article 2.6, all naming this hardener commit.

By hardener.
