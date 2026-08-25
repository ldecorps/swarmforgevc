# BL-1142 hardener pass — local Ollama mono vs forge CPU — 20260825

**Architect tip:** `a38725a860` (cleaner `ab0ccac40e` / coder `c16b58750e`)
**Task:** `BL-1142-local-ollama-mono-vs-forge-cpu`

## Tip purity

`git reset --hard origin/main` → ff architect tip.
`origin/main...HEAD` (pre-evidence) → **17 paths**, **0 deletes**.
Authorize **BL-1142 paths only**.

## Product surface

Durable local decision: mono-router depth 1 via
`local_ollama_pack_shape_lib.sh` + launch gate. Hardening locked the
router `capped-forge` branch (depth > mono max) so it cannot silently
collapse to `uncapped-forge`.

## Gates

| Gate | Result |
|------|--------|
| `local_ollama_pack_shape_test_runner.sh` | ALL PASS (incl. 02b capped-router) |
| APS BL-1142 feature | 4/4 |
| Property suite | 3/3 |
| Soft Gherkin | `outcome: inapplicable` — not a pass (BL-638) |
| Surgical (9) | killed=9 survived=0 skipped=0 |
| BL-149 | lib+gate `run`; start script + pack conf `skip-cooldown` |

## Soft → surgical (BL-638)

No Scenario Outline — hand surgical over lib classifiers / allow-list /
forbidden substitute. First sweep: 1 survivor (capped-router → uncapped);
killed by unit 02b + gate refuse + property depth∈[2,8].

## Commit note (BL-1124)

Full pre-commit `test:properties` lane still mutated live
`swarmforge-hardender` (fixture seed tip); tip restored from reflog to
`a38725a860`. Commit used recovery-only
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` after isolated
`npm run test:properties -- test/bl1142LocalOllamaPackShape.property.test.js`
(3/3) on the restored tip.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1142 only.

By hardender.
