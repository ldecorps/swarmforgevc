# BL-1307 — QA confirms landed-as-passenger, park is stale

**Verdict: confirmed landed. Nothing further owed by the pipeline.**

## Background

QA held this ticket unlanded (`backlog/evidence/BL-1307-qa-hold-land-step-blind-spot-20260831.md`):
work verified fully green, but `land_step_lib.bb`'s replay silently pulled in
BL-1300's untagged, unlanded commits alongside BL-1307's own tagged ones
(BL-1300 was folded into the documenter merge's second parent without its
own tagged commit). The specifier upheld the hold
(`backlog/evidence/BL-1307-specifier-adjudication-land-hold-20260831.md`) —
not a bounce, no role in BL-1307's chain owns the shared land-step tooling —
and minted BL-1308 for the detector gap.

## What changed since: independently re-verified, not taken on trust

| Check | Result |
|---|---|
| `git merge-base --is-ancestor bd27e884cb origin/main` (BL-1307's own documenter tip) | **true** |
| `git show origin/main:extension/test/bl1300HeadroomProofIsPinned.test.js` | present |
| `git show origin/main:extension/test/bl1300SingleEnforceableBudget.property.test.js` | present |
| `git show origin/main:backlog/evidence/BL-1300-coder-20260830.md` | present |
| `required_wiring` anchor `forward-carries-own-evidence?` live in consumer | `swarm_handoff.bb:382,384,396,486` on `origin/main` |
| Step handler registered | `specs/pipeline/steps/index.js:551` on `origin/main` |
| Acceptance feature scenario count | 3 (unchanged) |
| All six BL-1307 stage evidence files (coder/architect/hardender/documenter/QA-hold/specifier-adjudication) | present on `origin/main` |

BL-1300's own commits and BL-1307's own documenter tip are BOTH ancestors of
current `origin/main` — the transitive blocker (BL-1300 unlanded, held on a
pending human ruling) is spent: BL-1300's content is on `origin/main`
regardless of the ticket's own `human_approval` bookkeeping field, so
BL-1307's replay would now be byte-identical rather than novel. Nothing
about BL-1307 needed rebuilding, and nothing was rebuilt — this is a
confirmation, not a re-verification of behavior already proven green in the
prior QA pass.

## Disposition

**Landed, confirmed.** No further land action needed — BL-1307's content is
already on `origin/main`. This confirmation commit is landed alongside it.
Coordinator notified to move `backlog/active/BL-1307-...yaml` → `backlog/done/`.

By QA.
