# BL-757 — architect pass — 20260827

**Received:** `merge_and_process cleaner 2ed1333338` (handoff
`00_20260827T132436Z_000017_from_cleaner_to_architect`)
**Merged at:** cleaner `2ed1333338`
**Task:** BL-757-pilot-orphan-checker-never-run-against-real-tree

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Parcel intent

Wire `computeDocsStructure` against the real `docs/` tree: repo-scoped test +
dated allowlist for 18 pre-existing orphans + `/pilot` land refusal when touched
authored docs are orphaned. Option 1 (mechanical gate) per specifier pin.

## Checks

| Check | Result |
|-------|--------|
| APS | **7/7** (`BL-757-pilot-orphan-checker-never-run-against-real-tree.feature`) |
| Unit | **5/5** (`docsStructureRealTree.test.js`) |
| Dep-gate | PASSED (extension scope) |
| Allowlist | 18 dated entries in `docs_orphan_known_debt.tsv` |
| Land gate | `assessOrphanDocsLandCheck` wired via `pilotAcceptanceGate.ts` |

## Hitchhiker

Cleaner merge adds `docs/index.md` link for BL-834 how-to (unrelated to BL-757
scope but additive-only; does not violate invariants).

## Forward

`git_handoff` → **hardender**, task `BL-757-pilot-orphan-checker-never-run-against-real-tree`.

By architect.
