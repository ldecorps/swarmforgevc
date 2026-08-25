# Documenter rematch — BL-1142 onto origin/main

## Parcel tip
0cc3c42f35 (hardener; not based on current origin/main; prior documenter tip
265cc16ee0 also stale / never forwarded to QA)

## Rematch posture
`git fetch && git reset --hard origin/main` → restore BL-1142 product/docs
paths surgically. Do **not** hitchhike old tip whole-files that delete landed
BL-988/BL-999 index/Spec/steps wiring or drop BL-1143 from epic
`decomposes_into`. `dels=0`; ancestry verified immediately before handoff.

## Docs
- How-to: mono-router depth 1 decision + launch/gate path
- Spec Last Updated prepend; index link (additive)
- Evidence: decision, battery cite, stage passes

## Abandoned
`c16b58750`, `ab0ccac40`, `a38725a86`, `0cc3c42f35`, `f1ff2716f0`,
`d0e02628b1`, `55218fadec`, `265cc16ee0`

## Review inventory (Article 4.4)
NONE.

By documenter.
