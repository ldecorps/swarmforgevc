# Keep the chunking property falsifiable (BL-738)

*How-to. Task-oriented: ensure `splitTelegramChunks` property tests actually
cross the multi-chunk branch.*

BL-718’s length-independent mirror invariant needs a property that can fail.
A generator capped below `TELEGRAM_MESSAGE_MAX_LENGTH` (4096) never left the
early `return [text]` path — vacuous green.

## Fix (chosen)

Pass an explicit small `maxLen` into `splitTelegramChunks` from a shared probe
so ordinary generated lengths always split. Do **not** drive 12k-char inputs
against the live 4096 default (that re-introduces two hand-synced literals).

| Piece | Role |
| --- | --- |
| `CHUNKING_PROPERTY_MAX_LEN = 50` | Probe-only bound |
| Generator `minLength: 51` | Guarantees multi-chunk |
| `runChunkingProperty` | Asserts reassembly + `sawMultiChunk` |
| `brokenSplitDropsContinuationHead` | Scenario 02 falsifiability wrapper |

## Where

- Probe: `extension/test/helpers/chunkingPropertyProbe.js`
- Property: `extension/test/cursorBridgeLive.property.test.js`
- Acceptance: `specs/features/BL-738-chunking-property-reaches-the-split-boundary.feature`
- Steps: `specs/pipeline/steps/bl738ChunkingPropertySteps.js`

## Verify

```bash
cd extension && npm test -- cursorBridgeLive.property
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-738-chunking-property-reaches-the-split-boundary.feature
```

Related: [BL-718 Bubble talk mirror chunks](BL-718-bubble-talk-mirror-chunks-and-fails-loudly.md).
