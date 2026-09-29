# INTAKE — Pipeline board grid: show seat dwell time instead of `X`

**Source:** human via Cursor, 2026-09-29 ~21:54 BST, verbatim intent:
"new intake: instead of an X, can the grid show the number of minutes (or
hours) the ticket has been with the seat"

Attached context: a live pipeline-board grid screenshot (`NS SP CO CL AR HD
DC QA` columns; one `X` per active ticket under its current seat). Most
active rows were parked under QA — the human wants glanceable **how long**,
not only **where**.

**Surface:** Telegram pipeline-board grid (BL-452 family), rendered by
`extension/src/concierge/pipelineBoard.ts` → `renderGridMatrixLines`. The
same grid also feeds the bridge live grid (`pipelineGridLive.ts` /
`renderPipelineBoardGridOnly`).

**Priority:** normal (operator glanceability). Specifier may queue-jump if
the live QA pile makes dwell the thing people actually look for.

## What is wrong

Each active ticket's current seat is marked with a fixed `X` (elsewhere `.`).
That answers "where" but not "how long has it been stuck there". On a board
where many tickets sit under QA (or any one column), the grid cannot tell a
5-minute hop from a multi-hour stall.

Today (verified in code, 2026-09-29):

- `renderGridMatrixLines` hardcodes `(column === row.column ? 'X' : '.')`.
- Stage map entries already carry `asOf` / `healthDot` (BL-670 / BL-1451);
  captions use the health dot, but the **matrix cell does not use `asOf`**.
- Coarse dwell formatting already exists for the **HELD** section as
  `formatHeldForLabel` (`Nm` / `Nh` / `Nd` / `just now`) — same shape the
  human is asking for on the grid mark.
- Stage cells are width **2** (`PIPELINE_BOARD_STAGE_CELL_WIDTH`) under a
  phone width budget of **30** (`PIPELINE_BOARD_GRID_MAX_WIDTH`, BL-1155).
  Replacing `X` with `45m` / `12h` will not fit without a deliberate cell /
  budget decision.

## What is wanted

In the stage matrix, the occupied cell shows **how long the ticket has been
at that seat**, instead of (or as the replacement for) `X`. Empty seats stay
`.`.

Human wording: "the number of minutes (or hours)". Direction for the
specifier (not a locked design):

1. Reuse or share the coarsest-unit style already used for held dwell
   (`m` / `h`, and `d` when past a day) so a glance stays short.
2. Source the clock from the existing stage-map `asOf` (when present) —
   do not invent a second "entered seat at" store unless `asOf` is proven
   wrong or missing for role-held tickets.
3. Keep the board phone-readable (BL-1155 / BL-505 width discipline). If a
   multi-character dwell forces wider stage cells, say so in the ticket and
   pick one approach (wider cells + fewer columns visible rules, truncate
   glyphs like `9h+`, move dwell to the caption line, etc.) — that width
   trade-off is a real fork and should come back if it changes the glance
   layout.

Non-goals unless the specifier expands deliberately:

- Changing the HELD / PARKED / RECENTLY CLOSED list format (already has
  elapsed marks).
- A second live clock tick that edits the board when only wall-clock
  advanced with no stage change (today's content-signature gate — BL-462 —
  should stay coherent; dwell that advances without a stage change may need
  an explicit rule so the board does not spam-edit every minute).

## Success looks like

An operator glancing at the Telegram pipeline board can see, for each active
ticket, both which seat holds it and roughly how long it has been there
(minutes or hours), without opening the ticket or reading captions.

## Notes for the specifier

- Likely epic: pipeline-board / swarm-reliability (same family as BL-452,
  BL-940, BL-1045, BL-1451).
- Likely touch: `pipelineBoard.ts` matrix mark + tests/features that assert
  `X` today; possibly `pipelineGridLive.ts` consumers.
- Confirm whether `asOf` updates on every stage enter (including NS /
  not-yet-held) before baking it into the cell.

## Specifier disposition (2026-09-29)

Minted 1:1 as **BL-1818** (epic `pipeline-board`, BL-540), human_approval
pending with ruling_options. The human's sentence above survives verbatim
in BL-1818.

- Width fork: settled without a ruling. Folding the one-space separator
  into 3-character cells keeps every line at 27-29 characters for 3-5
  digit ids, and the header reads as before.
- Clock: the stage map's `asOf` is the parcel's `enqueued_at`, i.e. when
  it reached the stage, so no second store is needed. A ticket with no
  parcel keeps its X.
- Refresh: the one ruling asked. Today the board is deleted and reposted
  on any content change, so minute-level dwell needs a rule. Recommended:
  edit in place for dwell-only changes.
