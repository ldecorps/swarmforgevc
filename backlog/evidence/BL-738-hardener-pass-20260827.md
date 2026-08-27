# BL-738 — hardener tip-pure pass — 20260827

## Inbound

Architect `79b6b8a38c`. Tip-pure harden on that tip (BL-506).

## Defect fixed at harden

`specs/pipeline/steps/index.js` still carried unresolved conflict markers
plus BL-599/600/601 hitchhiker requires from the tip-pure cherry-pick.
Resolved to `bl738ChunkingPropertySteps` only so APS can load.

## Gates

| Gate | Result |
|---|---|
| Properties `cursorBridgeLive.property.test.js` | **4/4** |
| Acceptance BL-738 feature | **2/2** |
| Gherkin soft | **inapplicable** (no Scenario Outline) |
| Surgical sweep | **5/5 killed** |
| Cooldown (`chunkingPropertyProbe.js`) | **run** |

## Surgical mutants

`bl738_chunking_property_mutation_sweep.sh`: maxLen vacuity, generator under
boundary, sawMultiChunk recording, lossless reassembly assert, broken-split
continuation drop (scenario 02).

## Tip purity

Handoff delta on architect tip: index conflict clean + sweep script + this
evidence. No BL-599/600/601 hitchhikers.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-738-bl718-property-test-never-reaches-chunk-boundary`.

By hardender.
