# BL-1089 — hardener pass

Hardened architect tip `127289ccb9` (lineage `314ae2ca88` coder +
`fca2378083` cleaner + architect evidence). Scope: repaired liveness
fixture, shared `pollHeartbeatStale` adapter, APS steps, declared-invariant
property cover. Production `front_desk_supervisor.bb` /
`front_desk_supervisor_lib.bb` untouched in the BL-1089 commit range.

## Mutation gate

- **Stryker:** not applicable — no parcel `extension/src/**` / `out/**`
  production surface.
- **Gherkin (BL-113 soft):** `outcome: "inapplicable"` (plain `Scenario:`
  only; zero Example cells). Not treated as a pass (BL-638).
- **Hand-authored surgical sweep (BL-638 fallback):**
  `swarmforge/scripts/test/bl1089_liveness_fixture_mutation_sweep.sh`
  — `mutants: killed=12 survived=0 skipped=0` / `ALL MUTANTS KILLED`.
  Killers: property lane, live liveness suite, APS acceptance.
  Covers fixture age-0 repair, predecessor pin, APS label bite, adapter
  invert/always/never/3-arity drop, and step assertion/grace/hb flips.

Cooldown gate on all four parcel files: `DECISION: run` (load ~1.8 on 20
cores).

## Verification

| Check | Result |
|---|---|
| `test_front_desk_supervisor_liveness.sh` | ALL CHECKS PASSED (14 ok) |
| APS acceptance (5 scenarios) | 5/5 pass |
| `bl1089FrontDeskLivenessFixture.property.test.js` | 3/3 pass |
| Whole-tree guards (`test/*Guard*.test.js`) | 13 files / 125 tests pass |
| Sibling `test_front_desk_supervisor_tick.sh` | unchanged by this parcel (any remaining failure is BL-1088's) |
| CRAP / DRY / Stryker | N/A — no changed `src/*.ts` |

## Inventory

**NONE**

## Forward

`git_handoff` → documenter, priority `00`.
