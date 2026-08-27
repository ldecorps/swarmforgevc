# BL-738 — architect pass — 20260827

**Tip:** tip-pure coder `94b2447a0e` → architect `02370561cb` (cleaner tip `426ef2a8ff` was multi-ticket polluted; BL-738 paths only)
**Handoff:** `00_20260827T062003Z_000979_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Cherry-picked tip-pure BL-738 parcel (stripped BL-599/600/601 hitchhikers from `index.js` conflict). Functional paths:

- `extension/test/cursorBridgeLive.property.test.js`
- `extension/test/helpers/chunkingPropertyProbe.js`
- `specs/pipeline/steps/bl738ChunkingPropertySteps.js`
- `specs/pipeline/steps/index.js` (+ `bl738ChunkingPropertySteps` only)

## Invariants

1. **Falsifiable property** — `runChunkingProperty` + acceptance scenario 02 use `brokenSplitDropsContinuationHead`; APS confirms the property goes red.
2. **Boundary by construction** — explicit `CHUNKING_PROPERTY_MAX_LEN = 50` with generator `minLength: 51`; independent of `TELEGRAM_MESSAGE_MAX_LENGTH`. Property asserts `sawMultiChunk`.

## Architecture

- Probe helper keeps production `splitTelegramChunks` untouched; property and APS share one probe.
- No new production module coupling; test-only helper under `extension/test/helpers/`.
- Dep-gate N/A for production `src/` (test + steps only).

## Verification

| Check | Result |
|-------|--------|
| `cursorBridgeLive.property.test.js` | 4/4 pass |
| APS `BL-738-chunking-property-reaches-the-split-boundary.feature` | 2/2 pass |
| Tip purity vs prior architect tip | BL-738 paths only (+ evidence) |

By architect.
