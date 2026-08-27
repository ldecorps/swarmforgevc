# BL-757 — documenter pass — 20260827

## Inbound

Hardener tip `86f169d1e2`. Merge on `swarmforge-documenter` (conflict in
`pilot-acceptance-gate.ts` resolved — `checkOrphanedAuthoredDocs` kept;
`checkMultiBranchSiblingGating` omitted on this branch).

## Living docs

Extended BL-727 how-to with real-tree docs orphan gate section (suite +
`/pilot` land). Architecture diagram note added.

Acceptance + step handler landed upstream; ticket `acceptance:` already set.
Docs: `docs/how-to/BL-727-pilot-acceptance-contract-gate.md` (BL-757 section).

## Pre-QA

`specs/features/BL-757-pilot-orphan-checker-never-run-against-real-tree.feature`
(7/7 at hardener).

By documenter.
