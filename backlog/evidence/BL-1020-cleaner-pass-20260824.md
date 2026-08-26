# BL-1020 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `019f432142` (pack config is topology; leftover
mono-router-active-role ignored as stale on standing packs; honoured on
router packs) into `swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 019f432142 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb`:
   ok.
2. **Babashka properties** —
   `bb swarmforge/scripts/test/bl1020_stale_marker_topology_property_runner.bb`:
   ALL PROPERTIES HOLD (500 runs).
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1020-stale-mono-router-marker-is-not-topology.feature`:
   3/3 pass.

## Cleanup performed

- `bl1020StaleMonoRouterMarkerSteps.js`: Cheshire JSON from the real
  `resolve-resident-role` instead of regex-parsing `pr-str` EDN.
- `swarm_attach.sh`: parse `honour=` / `stale=` with anchored `([01])`
  captures (not substring globs).

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1020-stale-mono-router-marker-is-not-topology`.

By cleaner.
