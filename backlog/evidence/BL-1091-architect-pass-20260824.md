# BL-1091 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `b2fbc1f1a7` (on coder `3d59989362`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

Expedite paused→active rename must pathspec-commit **both** ends:

- `BacklogMoveResult.source` from `moveBacklogFileTo`
- `PromotionOutcome.source` → `commitExpediteWrites(…, sourcePath)`
- `commitApprovalWrites` accepts optional `extraAbsPaths`; cleaner
  `uniqueRelPaths` gathers destination + source
- In-place Approve/Reject/Amend still omit extras (single path)

APS 6/6 + property 2/2. Out of scope (per ticket): cleaning existing
duplicate ids; park/reinstate commit wiring.

## Architecture

- Matches approval: plural `--path` already on integrity CLI; surface the
  rename source rather than loosening scoping for in-place writers.
- Locked commit-integrity path preserved (BL-419/BL-490); only optional
  extras added.
- Sibling movers `parkToHold` / `reinstateFromHold` return `source` now via
  shared `moveBacklogFileTo`, but operator hold/reinstate does **not** call
  `commitApprovalWrites` — disk rename only. Not "already affected" by the
  single-path commit defect; not widened here (ticket instruction).
- No webview/host boundary change; stamp-off tip hygiene OK
  (`27273f2b0a`, BL-1113 9/9).

## Required hard gate

    node extension/out/tools/dependency-gate.js \
      src/util/commitIntegrityRunner.ts \
      src/panel/backlogWriter.ts
    → PASSED.

Property test imports `telegram-front-desk-bot` and surfaces standing
**BL-759** cycle — out-of-parcel; same edges as prior reviews.

## Invariants review (BL-633/BL-654) — 2 declared, both encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Move committed as both paths or neither | property + feature 01 | Green |
| 2 | Folder disjointness after Expedite | property + feature 01 | Green |

Non-vacuity: in-place approval still one path (property + Outline 03).

## Property-testing support (undeclared)

Declared pair covered. No additional undeclared property authored.

## Correctness read-through

- Acceptance 6/6; properties 2/2.
- Already-active Expedite still single-path clean.
- No prior BL-1091 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1091-expedite-commits-only-half-of-the-promotion-move`, commit = this
evidence commit (BL-536 / BL-806).

By architect.
