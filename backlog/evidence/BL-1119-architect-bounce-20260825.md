# BL-1119 — architect bounce (Article 4.4 inventory) — 20260825

Reviewed cleaner tip `7a16fffd04` (coder `b82979e57e` + cleaner DRY of
`dialForRole` citedFields) on `origin/main`=`7e430470c0` lineage.

## Scope

- `extension/src/quality/closingCeremony.ts` — dial + packet field
- `extension/src/metrics/closingCeremonyStore.ts` — refuse on `no_change`
- APS + unit + `bl820` closed packet keys (+ `qualityRecommendations`)
- Tip vs origin/main: **10 paths**, BL-1119-only (bl820 key list is closed-shape
  follow-through, not a foreign ticket)

## Architecture — PASS (with wiring caveat under D1)

Pure quality fold + metrics store; no webview/storage; dep-gate on parcel TS
**PASSED**. Co-change with ceremony/BL-820 surfaces expected. `bl820` APS key
list update is required closed-shape, not hitchhike.

## Dependency-rule gate

```
cd extension && node out/tools/dependency-gate.js \
  src/quality/closingCeremony.ts src/metrics/closingCeremonyStore.ts
→ PASSED
```

Standing full-repo `acyclic` cycle remains **BL-759** (out of parcel).

## Acceptance / units

- Gherkin BL-1119 → **6/6 PASS** (drives pure `buildClosingCeremonyPacket` with
  explicit `windowModels`)
- `vitest run test/closingCeremony.test.js` → **37/37 PASS**

## Inventory

### D1 — `behavior` (blame: coder) — live path never supplies window models

Invariant 3: auto window models (`auto`, `cursor/auto`, `copilot/auto`, …)
must never receive raise/lower — hold/skip only.

`isAutoWindowModel` / `dialForRole` implement that **only when**
`windowModels` is passed into `buildClosingCeremonyPacket`.

Live orchestrator does not:

```50:50:extension/src/metrics/closingCeremonyRun.ts
  const packet = buildClosingCeremonyPacket(shiftKey, allEvents);
```

Default `windowModels = {}` → `isAutoWindowModel(undefined)` is false → a
stalling role on `--model auto` still gets `dial: 'raise'` in the delivered
packet. Repro (compiled out/):

- events: one `stall` for `coder`
- `buildClosingCeremonyPacket(shift, events)` → `{ dial: 'raise', … }`
- `buildClosingCeremonyPacket(shift, events, { coder: 'auto' })` → `{ dial: 'hold', disposition: 'held' }`

APS/unit only exercise the pure API with injected models — they do not cover
`runClosingCeremony`. Sites to fix in one pass: every production caller of
`buildClosingCeremonyPacket` (at least `closingCeremonyRun.ts`); load real
window models from pack/effective config the ceremony already can see; add an
acceptance or unit that builds via **`runClosingCeremony`** (or the CLI) with
an auto seat and asserts hold.

### D2 — `invariant-unencoded` (blame: coder)

Three declared invariants; **no** `extension/test/bl1119*.property.test.js`
(or equivalent under `npm run test:properties`). Existing
`closingCeremonyInvariant.property.test.js` / dwell properties are BL-820 /
occupancy only — they do not encode BL-1119.

Remediation (coder first authorship): non-vacuous properties for

1. recommend-only — ceremony/outcome paths never mutate pack conf bytes
2. citedFields ⊆ lean ledger field vocabulary (stalls / bounce.blamedRole /
   stage_transition etc. — no parallel metric store)
3. for every auto model id in the generator, dial is hold (and never
   raise/lower), including through the **wired** run path once D1 is fixed

Show RED when deliberately broken, then restore.

### Property-testing support (undeclared) — BLOCKED BY D2

Pure `computeQualityRecommendations` / `isAutoWindowModel` are property-shaped;
declared encoding must land first (do not author here).

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | behavior | coder | bounce |
| D2 | invariant-unencoded | coder | bounce |

No architecture rule failure beyond the live wiring gap in D1.

## Forward

`git_handoff` to `coder`, priority `00` — do **not** forward to hardender.

By architect.
