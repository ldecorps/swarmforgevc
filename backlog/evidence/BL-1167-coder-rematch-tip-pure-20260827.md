# BL-1167 — coder rematch (tip purity) — 20260827

## Bounce

QA `6e49b8a02d` / parcel `378c873759`: documenter tip `8578caf5d3` entangled
on merge (BL-781/780/1185/605 hitchhikers; would delete landed
`globalTokenConsumption.test.js`) — BL-506.

## Remediation

Single-parent tip on current `origin/main`. Product from tip-pure
`fa828f195` (same-model bypass; no BL-1185 hitchhiker) + hardener sweep +
BL-1167-only documenter overlays (how-to, Spec LU, pack conf note).
Prior tips under `abandoned_commits:`.

**Next roles:** checkout named paths only; no `-s ours` onto a polluted
role branch.

By coder.
