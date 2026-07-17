# Intake: pipeline board grid still doesn't fit — shorten the ticket id and/or kebab slug further

Filed by the coordinator (2026-07-17), relaying a request the human made directly
while looking at a live pipeline board render.

This is a RAW ask, not a spec: the specifier drains this like any other
backlog-root item and decides what (if anything) becomes a real ticket.

## What the human asked (verbatim intent)

"We have to save space on the grid, it does not fit on the one [screen/message].
Only keep the digit of the ticket and/or shorten even more the kebab case slug."

The human pasted a live render showing the grid (TICKET/SLUG + 9 stage
columns) plus the PARKED and RECENTLY CLOSED list sections still overflowing
the available width.

## Coordinator context (not a decision — specifier owns the call)

The renderer is `extension/src/concierge/pipelineBoard.ts`:
- Grid `TICKET` column renders the full `item.id` (e.g. `BL-493`) via
  `idColumnWidth`/`renderHeader`/`renderDataRow` (lines ~228, 300, 391-405).
  Dropping the `BL-`/`GH-` prefix and showing only the digits (`493`) would
  narrow this column from ~6 chars to ~3.
- Grid `SLUG` column comes from `deriveKebabSlug(title, maxWords = 3)`
  (line 163) — currently up to 3 hyphenated words. Shortening further means
  either reducing `maxWords` or capping each word's length (or both).
- The PARKED/RECENTLY CLOSED list sections use `deriveListEntryText` /
  `PIPELINE_BOARD_SLUG_MAX_LENGTH = 60` (lines 178-208), a *wider* combined
  kebab-slug-plus-title line — likely the bigger offender in the human's
  screenshot (each entry visibly wraps or truncates awkwardly). The specifier
  should decide whether this line also needs shrinking, or whether the human's
  ask was scoped to the grid's own two columns only — ask if ambiguous.

## Constraints already load-bearing here (do not break)

- `deriveKebabSlug`/`PIPELINE_BOARD_SLUG_MAX_LENGTH` were widened twice
  already by BL-462 and BL-465 in the OTHER direction ("longer slug, same
  line") — this ask reverses that direction, so re-check those tickets'
  acceptance criteria for any lower-bound assumption a narrower slug would
  now violate.
- BL-502 (just closed) fixed the pipeline board's Telegram 4096-char message
  budget — a narrower grid helps that budget, so this is a compatible
  direction, not a conflicting one.
- Ticket ids must stay UNAMBIGUOUS: if only digits are shown, confirm no
  live board mixes `BL-` and `GH-` ids that would collide on the same digits
  (grep both prefixes across `backlog/active/` and `backlog/done/` before
  assuming safety).

## Ask for the swarm

Specifier: write a spec that (a) drops the ticket-id column to digits-only
(or another explicit shorter form the specifier judges best, e.g. no leading
zeros, keep prefix only when a `GH-`/`BL-` collision is possible) and (b)
shortens the kebab slug further (fewer words and/or a per-word char cap),
enough that a full render (grid + PARKED + RECENTLY CLOSED) fits the human's
actual display without wrapping. Confirm with the human what "does not fit on
the one" means (screen width in characters, or the Telegram message unit) if
that is not already clear from BL-502's format work, before finalizing exact
widths.
