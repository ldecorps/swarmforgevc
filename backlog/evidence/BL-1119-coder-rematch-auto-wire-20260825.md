# BL-1119 — coder rematch after architect bounce — 20260825

Architect bounce `57a70662e4`: D1 live auto dial unwired; D2 invariants
unencoded.

## D1 — wire window models into live run path

- `parseWindowModelsFromConf` (pure) + `readWindowModelsFromTarget` (swarm-identity
  pack path → `window <role> … --model <id>`).
- `runClosingCeremony` always passes window models into
  `buildClosingCeremonyPacket` (injectable `deps.readWindowModels`).
- Unit: `closingCeremonyRun.test.js` — auto pack + stall → `dial: hold`
  via **wired** `runClosingCeremony` (not only pure API injection).

## D2 — property encoding (`npm run test:properties`)

`extension/test/bl1119ClosingCeremonyRoleQualityDial.property.test.js`:

1. recommend-only — ceremony + `no_change` leaves pack conf bytes unchanged
2. citedFields ⊆ lean vocabulary (`stalls` / `bounce.blamedRole` /
   `stage_transition`)
3. auto models hold on wired `runClosingCeremony` path

## Proof

- unit: closingCeremony 38 + closingCeremonyRun 7 green
- properties: 3/3 green
- APS BL-1119: 6/6 green

By coder.
