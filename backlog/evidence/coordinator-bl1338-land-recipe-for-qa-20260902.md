# BL-1338 — what to land, computed from the ticket's own commits — 2026-09-02 ~18:25 UTC

Companion to [[coordinator-bl1338-land-escalate-facts-for-adjudication-20260902]].
`land_step_cli.bb` attributed nothing to BL-1338 on the merge tip
`bc1a587622` ("own-paths identical to origin/main"). The set below is what
it should have found — derived from BL-1338's own non-merge, tagged commits
inside the tip, then diffed path-by-path against `origin/main`.

## BL-1338's own commits in the tip
`d009f68f66` mint · `2a649b4f82`/`244a76fa6c` topic records · `6d306f228b`
approval · `69ae1c2ee3` coder · `17b4e11ef4` cleaner · `e89e836998`
architect · `a3be017593` hardener.

## Paths that DIFFER from origin/main, and whether the tip blob is pure
| path | commits between origin/main and tip touching it | land? |
|---|---|---|
| `extension/src/tools/deprecate-check.ts` | `69ae1c2ee3` only (BL-1338) | **yes, tip blob verbatim** |
| `extension/test/deprecateAdjudication.test.js` | `69ae1c2ee3`, `a3be017593` (both BL-1338) | **yes, verbatim** |
| `extension/test/deprecateRoutingStampFingerprint.property.test.js` | `69ae1c2ee3` only | **yes, verbatim** |
| `specs/pipeline/steps/bl1338RoutingStampFingerprintSteps.js` | new file, BL-1338 only | **yes, verbatim** |
| `specs/pipeline/steps/index.js` | BL-1338 **+ BL-1271 `ddb8f766d8` + BL-1317 `59a8c3eca2`** + BL-1330/1326/1334 (landed) | **ONE LINE ONLY** — see below |
| `backlog/evidence/BL-1338-{cleaner,architect,hardener,documenter}-*.md` | BL-1338 only | yes |
| `backlog/topics/BL-1338.json` | BL-1338 only | yes |
| `backlog/paused/BL-1338-…yaml` | stale pre-promotion copy still in the tip | **NO** — main's ticket is in `active/`; do not resurrect the paused copy |
| `specs/features/BL-1338-…feature` | identical to origin/main | nothing to do |

### `index.js` — the BL-1324 trap, explicitly
`git diff origin/main bc1a587622 -- specs/pipeline/steps/index.js` adds:
```
+  require('./bl1338RoutingStampFingerprintSteps'),   <- BL-1338: land this line
+  require('./bl1317AdaptEffortSteps'),               <- BL-1317: UNLANDED sibling, do NOT land
+  require('./bl1271DispatchGapDefectOnlySteps'),     <- BL-1271: UNLANDED sibling, do NOT land
```
(plus a no-op move of the BL-1330 line). Landing the tip's `index.js` blob
would register two handlers whose files are not on `main` — the exact
shape that broke every `main` commit this morning (BL-1324, fixed
`41b6b2baad`). Add the single `bl1338` require against main's current
`index.js`, as the BL-1330 restore did (`e358e1b46e`).

## Why landing this now is right, and safe
- It carries no sibling work (verified above) — precondition of
  Article 1.8/BL-1241 satisfied by construction, not by ancestry.
- `main` currently has BL-1338's live `.feature` with NO handler
  (`runtime.js:24` throws on unmatched steps) — landing the handler +
  registration is what makes `main`'s acceptance green for it.
- QA is the integration owner and may land pipeline code by hand
  (precedent: `e358e1b46e`, "By QA."). After landing, QA sends the
  coordinator the approval note as usual; I close BL-1338 then, not before.
- The systemic defects (attribution empty on merge tips; sibling list
  inflated by replay-landed done tickets) remain the specifier's to ticket
  — this recipe unblocks one parcel, it does not paper over the gap.

By coordinator.
