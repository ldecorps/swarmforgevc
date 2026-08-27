# BL-1053 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner tip `fa9fba64df` (fast-forward into architect worktree).
Lineage: `60ef226200` (coder, local provider key) + `fa9fba64df` (cleaner,
single-resolve launch-agent path). Prior architect pass
`BL-1053-architect-pass-20260822.md` covered the **retired qwen-cloud**
contract — this pass is for the reframed `local` → `local-model` slice only.
No prior QA bounce on this reframed parcel (main/origin/main aligned;
supersede disposition on the old contract is evidence, not an open defect).

## Scope

Registers provider key `local` → agent `local-model` in
`model_factory_lib.bb`'s `provider->agent` map; `agent-for-provider` returns
nil (not the provider name) for unknown keys; `resolve-launch-agent` reports
known/unknown with a named reason; `require-launch-agent!` makes `assign-role`
throw by name rather than emit a descriptor with `:agent nil`. Cleaner collapses
duplicate map lookups into resolve → require. APS step handler
`bl1053LocalProviderRoutingSteps.js` registered in `specs/pipeline/steps/index.js`;
unit + property runners; CLI suite hooks.

## Architecture

- Integrate-not-fork: maintained SwarmForge fork under `swarmforge/scripts/`
  (Local Engineering Architecture Rule 2) — not a user's separately-installed
  SwarmForge.
- No `extension/**` production surface touched for the feature (step handler
  under `specs/pipeline/steps/` is the APS binding, not a webview/host I/O
  boundary). No browser storage, no secrets in the target tree.
- Policy stays pure: `model_factory_lib.bb` remains a lookup/report/guard over
  an in-memory map; Steward registration stays the only path for adding a
  second on-host model (invariant 2).

## Required hard gate: dependency-gate.js

Parcel touches no `extension/src/**` modules. Full-repo scan after
`npm run compile`:

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

Pre-existing, tracked as `BL-759`
(`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`).
Parcel files are none of those three. Not re-reported (BL-759 / BL-1063).

## Co-change

`index.js` and `model_factory_lib.bb` show the usual hub-file partner lists;
none of the flagged partners were touched by this parcel beyond the additive
registration. Informational only; judged non-actionable.

## Invariants (both declared)

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Every provider key resolves to exactly one launch agent; unknown providers do not fall through to a guessed agent | `bl1053_provider_routing_property_runner.bb` P1/P2b/P3 | Green; non-vacuity reconfirmed below |
| 2 | Registration is model-generic — second local model is Steward-only, no map edit | unit runner §05 + feature scenario 05 + property P2a (local≠openai collapse) | Green |

Non-vacuity (empirical, this pass): restored
`(get provider->agent provider provider)` fallback; property runner produced
1500+ failures naming the echo-as-agent bug; restored file; `git diff` clean;
re-ran → `ALL PROPERTIES HELD (300 runs)`.

## required_wiring

- Live map entry `"local" "local-model"` confirmed via `(load-file …)` /
  `agent-for-provider` / `resolve-launch-agent` — not comment-only.
- `require('./bl1053LocalProviderRoutingSteps')` is a live `DOMAINS` entry.
- Named agent is in `prompt_engine_lib/supported-agents` and
  `swarmforge.sh` validate_agent allow-list (BL-1052 already staffed the seat).

## Property-testing pass (undeclared)

Touched pure surface is fully covered by the declared-invariant runner.
No additional undeclared property warranted; none manufactured.

## Correctness read-through

End-to-end read of coder+cleaner diffs. Cleaner's
`require-launch-agent!` returns the resolved agent once (no second
`agent-for-provider` after the unknown guard) — definitionally identical to
the coder's assert-then-lookup, less duplication. No correctness defect found
that warrants a send-back.

## Verification re-run live

- `npm run compile` (extension/): clean
- `dependency-gate.js` full-repo: BL-759 edges only (ticketed)
- `bb …/bl1053_local_provider_routing_test_runner.bb` → ALL PASS
- `bb …/bl1053_provider_routing_property_runner.bb` → ALL PROPERTIES HELD (300);
  break-and-restore non-vacuity above
- `bb …/model_factory_test_runner.bb` → ALL PASS
- `bash …/test_model_factory_cli.sh` → 16/16 + 01d/01e PASS
- `node specs/pipeline/cli.js` on BL-1053 feature → **8/8 pass**

## Verdict

**NONE.** Forward to hardender.

Note (not a bounce): untracked
`swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh` remains
in this worktree from prior sessions — ticketed BL-724; left untouched.

— By architect.
