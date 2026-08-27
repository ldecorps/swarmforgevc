# BL-660 hardener pass rematch6 — QA bounce BL-617 cooldown — 20260826

**Documenter tip:** `7f4f45804d` + QA bounce `9e009cbec`
**Task:** `BL-660-three-shift-packs-conf-selectable`

## Root cause

- APS step loaded stale `out/tools/cooldownWindowCore.js` (pre-shift-derivation) while
  `swarm_shift night` conf was set — `parseCooldownConfig` returned `enabled: false`
  at BL-617 step (`false !== true`). Same class as BL-497 stale-compile false-fail.

## Fix

- `bl660ThreeShiftPacksSteps.js`: Background probes night-shift cooldown derivation;
  runs `npm run compile` + cache-bust reload when stale; steps use fresh module exports.

## Purity

- Sibling hitchhiker grep vs `origin/main`: **0 matches**

## Gates

| Gate | Result |
|------|--------|
| bb property runners + applier smoke | ✅ |
| `swarmShiftCore.test.js` | 5/5 (after compile) |
| APS BL-660 | 9/9 |
| Gherkin mutation (hard) | 3/3 killed |

Pass → documenter.
