# BL-465 landed: BL-462's own grid-slug scenario is now stale

BL-465 (pipeline board render round 2) shipped commit-pending on the
coder branch, per the human's own REFINED instruction 2026-07-16 ("add
the slug back to the pipeline board grid — room enough for 2 or 3
words"): the stage grid's SLUG column now shows a short (2-3 word) kebab
slug only; the below-grid list sections (parked/awaiting-approval/
root-intake/recently-closed) show the kebab slug plus a WIDER truncated
title instead.

This deliberately supersedes BL-462's own "wider slug in the grid"
contract (deriveTicketSlug/PIPELINE_BOARD_SLUG_MAX_LENGTH used to size
the GRID's own slug column) — BL-465's own ticket text says so
explicitly ("grid = slug-only column, below-grid lists = slug + wider
title; feature file board-round2-01/01b re-split accordingly").

One scenario in specs/features/BL-462-pipeline-board-wider-slug-updated-at-repost.feature
is now failing as a direct, expected consequence:

  Scenario: A title longer than the wider limit is truncated to one line

This scenario's own premise (the GRID's slug column shows a wide
truncated title) no longer holds — the grid now shows the SHORT kebab
slug instead; the "wider truncated title" behavior moved to the
below-grid lists (now covered by BL-465's own board-round2-01b
scenario instead).

This mirrors the exact BL-452-vs-BL-462 precedent (BL-470): a later,
human-approved refinement superseded an earlier ticket's own scenario,
and the specifier retired the stale scenario + its step handlers as a
dedicated follow-up. Flagging this the same way rather than touching
BL-462's feature file myself (Gherkin scenario retirement is the
specifier's lane, not the coder's, per this session's own established
BL-470 precedent) — recommend a small follow-up ticket (mirroring
BL-470) retiring/amending this one scenario once BL-465 is reviewed.

Every other BL-462 scenario (7/8) still passes unaffected — this is a
single, narrow, foreseeable regression, not a broader BL-462 breakage.
The extension's full unit suite stays green throughout (5050+ tests).
