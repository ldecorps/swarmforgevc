# BL-1166 — architect pass — 20260827 (cleaner duplicate-export fix)

**Received:** `merge_and_process cleaner bbebdb96d3` (handoff
`00_20260827T121452Z_000001_from_cleaner_to_architect`)
**Merged at:** `7c5020fcf` on `swarmforge-architect`
**Reviewed tip:** cleaner `bbebdb96d3` — remove duplicated `operatorDocs` /
`mergeOperatorDocsIntoUiBundleManifest` block in `letsTalkRoutes.ts`

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Parcel delta

Cleaner removed a second copy of `operatorDocs` and
`mergeOperatorDocsIntoUiBundleManifest` that had been appended to
`letsTalkRoutes.ts` (would have been a duplicate export / redeclaration hazard).
Single canonical export remains at lines 33–48; `required_wiring` for
`letsTalkRoutes.ts::operatorDocs` still satisfied.

## Checks (complete inventory — Article 4.4)

| Check | Result |
|-------|--------|
| Dependency gate (BL-259) | **PASSED** on letsTalkRoutes, operatorDocsCore/Html, bridgeServer |
| Unit `operatorDocsCore.test.js` | **7/7** |
| Property read-only invariant | **1/1** |
| Invariants | Read-only property encoded; Divio navigation via unit + acceptance (unchanged) |
| Architecture boundaries | Bridge-owned I/O, read-only GET routes, no duplicate manifest merge — OK |
| `bl1166OperatorDocsSteps` registered | OK (index.js merge conflict resolved) |

## Forward

`git_handoff` → **hardender**, task `BL-1166-bubble-authored-docs-index-and-first-pages`.

By architect.
