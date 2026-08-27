# BL-1169 — architect pass — 20260827

**Tip:** tip-pure coder `1d4da9a95` → architect `51582a75f` (+ cleaner evidence `8fca24568`); cleaner tip `6f9e1dea48` sat on polluted ancestry — BL-1169 paths only.
**Handoff:** `00_20260827T070658Z_000984_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Functional paths only:

- `swarmforge/scripts/babysitterd_sweep_lib.bb`
- `swarmforge/scripts/test/babysitterd_sweep_lib_{test,property}_runner.bb`
- `specs/pipeline/steps/bl1169BabysitterHalfLaunchStarvationAutoRepairSteps.js`
- `specs/pipeline/steps/index.js` (+ one require)
- `specs/features/BL-1017-babysitterd-recreates-vanished-standing-session.feature` (scenario 03 half-launch boundary retired)

## Architecture

- Half-launch CRIT keeps the alert and `assoc`s `:ensure-session` only when `should-stand?` ∧ `session-repair-allowed?` — topology gate by construction (BL-1017 inv reuse).
- Swarm-starved CRIT at streak ≥ 2; `:ensure-control-plane` from streak ≥ 3 (`default-swarm-starved-ensure-streak`); repair alongside alert.
- Starved check runs before role mapcat so control-plane ensure suppresses per-role ensure (no double-repair footgun).
- UNAVAILABLE / process-gather-failed stays repair-free (BL-802).

## Invariants

1. **CRIT remains visible when repair queued** — unit + APS 01/03; repair is `assoc` on the CRIT map, never a replace path.
2. **Standing-pack launch-contract health** — APS 04 ensure succeeds when contract healthy.

## Verification

| Check | Result |
|-------|--------|
| `babysitterd_sweep_lib_test_runner.bb` | ok |
| `babysitterd_sweep_lib_property_runner.bb` | ok |
| APS BL-1169 feature | 4/4 pass |
| APS BL-1017 feature | 5/5 pass |

By architect.
