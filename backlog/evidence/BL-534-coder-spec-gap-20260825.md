# BL-534 — coder spec-gap (Article 4.4), 2026-08-25

Status: **blocked on specifier.** No implementation parcel. Reported under
Article 4.4 (spec gaps leave by `note`, never a parcel bounce).

## Inbound

Coordinator `note` `20260824T230901Z_001445`: Work
`BL-534-thin-main-crap-visible-cli-gate: read file in backlog/active`.

No merge tip on this note. Ticket on this worktree (and on `origin/main`)
lives only at `backlog/paused/BL-534-thin-main-crap-visible-cli-gate.yaml`
— it is **not** in `backlog/active/`.

## Why coder cannot implement

1. **Still parked / not active.** Coordinator Work text says
   `backlog/active`, but the YAML remains under `paused/` with
   `status: todo` and `assigned_to: specifier`. Routing a paused
   specifier-owned ticket to the coder skips the mint gate.
2. **No feature file.** There is no
   `specs/features/BL-534-*.feature` (and no `.feature.draft`). Coder
   does not hand-author Gherkin (`coder.prompt` / Article 1.2).
3. **`acceptance:` is still an inline Gherkin sketch.** One scenario
   embedded in the YAML body — hygiene may allow that as a not-yet-drafted
   placeholder (BL-922 / BL-626); it is not an armed APS contract. No
   pointer path, no step-handler binding, no gate entrypoint named.
4. **Open design for the gate itself.** Outcome names "lint/gate for
   `extension/src/tools/*`" and cites the BL-512 inventory CLI pattern,
   but does not name: (a) which runner owns the gate (vitest? scripts/
   quality? pre-commit? hardener checklist?), (b) how "thin" is measured
   (AST cyclomatic threshold? banned statement kinds in `main`? export
   presence only?), (c) whether existing non-thin tools fail closed on
   first land or are grandfathered. Inventing those as coder is
   specifier work.

## Remediation (specifier)

1. Keep (or reconfirm) the ticket in `paused/` until acceptance is armed.
2. Decide the measurement and runner for the thin-main gate; write them
   into the ticket.
3. Author `specs/features/BL-534-….feature` covering at least the sketched
   scenario (and any grandfather / fail-closed rules).
4. Flip `acceptance:` to a single-line path pointer to that feature.
5. Notify coordinator to promote + route to coder (and notify the holder)
   per "Amending An In-Flight Ticket's Spec".

## Pack

`cursor-forge` has a specifier seat. Article 4.4 notes go to **specifier**
and **coordinator** (priority `00`).

## What the coder did

No production or test code. Evidence only. No `git_handoff` to cleaner
(No-Op Rule). Completing the inbound task after the priority-00 notes.

## Specifier disposition (2026-08-25)

Armed acceptance: `specs/features/BL-534-thin-main-crap-visible-cli-gate.feature`
with runner/measure/grandfather decisions in the ticket description.
`acceptance:` is now a single-line path pointer. Ticket stays in `paused/`
with `human_approval: pending` until Approvals; then coordinator promotes.
