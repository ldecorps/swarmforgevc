# Documenter evidence — BL-1081 re-entry

## Ticket

BL-1081-an-acp-host-in-a-pane-can-drive-one-seat

## Hardener tip

db6e3a496c

## Posture

Recreated `swarmforge-documenter` on hardener tip (1081-only on
`origin/main`). Hitchhike gate CLEAN. Product ACP host already on main;
delta is APS wake-style baseline for `local-model`.

## Review inventory (Article 4.4)

NONE.

## Docs impact

- Spec Last Updated: re-entry / `local-model` wake-style baseline.
- Reference `BL-1081-acp-hosted-seat-snapshot.md`: active ticket path;
  scenario-05 baseline note for `local-model`.
- Architecture comment for re-entry.

## Acceptance cross-check

Aligned with `specs/features/BL-1081-an-acp-host-in-a-pane-can-drive-one-seat.feature`.
