# BL-1116 — architect bounce (Article 4.4 inventory) — 20260825

Reviewed cleaner tip `cc1e1212f2` (coder `6cebdcd4f`) on `origin/main`=`cb12bfd8ba`
lineage.

## Scope

Stamp-off batch for ledger keys `b81334b107`, `4d5375fdad`, `ae983877c4`,
`d6214efe6f`, `f88913a3df` — bridgeAuth path credentials, approval-ask skip,
Let's Talk / front-desk routing, launch-script seat models, `acpHostClient`.
Tip vs origin/main: **18 paths**, BL-1116-only (ledger rows in-scope).

## Architecture — PASS (with property-encoding gap under D1)

- Stamp-off of already-authored hotfixes; core blobs match tips for
  `bridgeAuth`, `approvalAskReconcile`, `backendSwitch`/`modelDisplayName`,
  `acpHostClient`, `cursorBridgeAgentSession`.
- `bridgeServer` / `telegram-front-desk-bot` differ from original tip tips
  only via later main ancestry (e.g. BL-833 host-activity) — not a redesign
  of this batch.
- Extension-host modules; no webview storage; dep-gate on parcel TS **PASSED**.
- APS drives real modules (not reimplemented stubs) once `out/` is fresh.

## Dependency-rule gate

```
cd extension && node out/tools/dependency-gate.js \
  src/bridge/bridgeAuth.ts src/swarm/acpHostClient.ts \
  src/concierge/approvalAskReconcile.ts src/swarm/backendSwitch.ts \
  src/swarm/modelDisplayName.ts
→ PASSED
```

## Acceptance / units (advisory — do not hand-verify invariants without encoding)

- vitest bridgeAuth + acpHostClient → **28/28**
- APS BL-1116 → **5/5** (after compile; scenario 1 fails on stale `out/`)
- Ledger rows: all five `state: pending` / `human_decision: null`

## Inventory

### D1 — `invariant-unencoded` (blame: coder)

Two declared invariants; **no** `extension/test/bl1116*.property.test.js`
(or equivalent under `npm run test:properties`). APS steps only `git cat-file`
reachability + behavioural smoke — they are not the property-test obligation
(architect.prompt / BL-633). Missing encoding for:

1. Stamp-off never reimplements — confirm/refute the five landed commits only
   (e.g. tip blob / tip-snippet identity for each key's primary surface, RED
   when HEAD drifts from tip without a stated rematch reason).
2. Green tests never write `certified` / `waived` into the hotfix ledger —
   assert each of the five rows stays `pending` / `human_decision: null`
   (RED if a test path flips `state`).

Remediation (coder first authorship): non-vacuous `*.property.test.js` for
both; show RED when deliberately broken, then restore. Follow BL-1115 / BL-1117
stamp-off property shape.

### Property-testing support (undeclared) — BLOCKED BY D1

Declared encoding must land first (architect does not author it).

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | invariant-unencoded | coder | bounce |

No architecture rule failure beyond the missing property encoding.

## Forward

`git_handoff` to `coder`, priority `00` — do **not** forward to hardender.

By architect.
