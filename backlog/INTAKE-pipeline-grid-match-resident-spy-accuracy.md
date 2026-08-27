# INTAKE — Pipeline STATUS GRID must match Resident Spy accuracy on who is doing what

**Source:** human (Laurent) via Cursor, 2026-08-27 ~10:23 BST  
**Status:** new intake, not minted  
**Surface:** PWA Pipeline STATUS GRID (`e.musicalsifu.com` / `/pipeline-grid`)

## Problem

The **Resident Spy** has a far more accurate view of who is doing what than the
**Pipeline STATUS GRID**. On the phone grid, almost every active ticket shows
**X under CO** while Spy correctly shows other seats (hardener, architect, QA,
…) actively working different tickets. The grid is not a reliable “who is doing
what” surface.

## Evidence (2026-08-27)

- Screenshot: STATUS GRID updated ~1s ago; nearly all active rows marked CO;
  only BL-428 at NS.
- Code: `extension/src/bridge/pipelineGridLive.ts` still stages from
  `.swarmforge/board/ticket-stage-map.json` via `readTicketStageMap` — the
  coordinator **cache**.
- Telegram board already uses live `pipeline_stage_cli.bb report` each tick
  (**BL-487** / `readLiveRoleHeldTickets`) — PWA path was left on the stale
  cache.
- Live forensics: cache and live `report` disagree on several tickets; deep
  coder `new/` queue (~29) also floods CO even when live is right, because
  stage = “parcel in role mailbox (new or in_process)” not “agent en cours.”

## Desired

Make the Pipeline STATUS GRID **as accurate as Resident Spy** about who is
doing what — or at least no worse than Telegram’s live board, and clearly
distinguish **claimed / working now** from **queued at a role**.

Concrete ask (specifier locks design):

1. **Freshness:** Wire `pipelineGridLive.ts` / `capturePipelineGridLive` to the
   same live `pipeline_stage_cli.bb report` path Telegram already uses
   (BL-487), so e.musicalsifu.com does not lag or disagree with the cache.
2. **Semantics vs Spy:** Align “working” marks with Spy’s signal —
   **in_process claim + live pane** (`residentPaneLive` / `residentPaneSpy`) —
   so a deep coder `new/` backlog does not read as “everyone is coding.”
3. **Queued vs claimed:** Treat mailbox `new/` (queued / in-transit) distinctly
   from claimed work — finish or supersede paused **BL-670**
   (`last-known` + richer `{stage,status,asOf}`) if that is the right home;
   do not leave “almost everything CO” as the operator-facing truth.

## Related

- Resident Spy: `extension/src/bridge/residentPaneLive.ts`,
  `residentPaneSpy.ts`, `/resident-spy`
- Grid: `pipelineGridLive.ts`, `pipelineBoard.ts`, `pipeline_stage_cli.bb`,
  `pipeline_stage_lib.bb`
- Precedent: BL-464 (note-aware stage map), BL-487 (Telegram live report),
  BL-1048 (`new/` + `in_process` scan), **BL-670** paused (last-known stage +
  health)

## Out of scope

- Replacing Resident Spy; this is making the grid trustworthy beside it.
- Changing seat difficulty / Work-note attribution (BL-1185) except insofar as
  coder `new/` volume is explained in evidence.

## Ask for specifier

Mint a ticket (or reopen/extend BL-670 if clearly better). Acceptance must
prove: (1) PWA grid uses live stage derivation, not a stale cache alone;
(2) claimed/working tickets are not drowned by coder queue noise the way Spy
already avoids; (3) operator can trust the grid for “who is doing what”
without opening Resident Spy as the only accurate view.
