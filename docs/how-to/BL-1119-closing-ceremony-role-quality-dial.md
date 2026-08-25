# Closing ceremony per-role quality dial (BL-1119)

Slice 1 of the end-of-shift quality lever: the closing-ceremony packet that
already reaches the specifier (BL-820) now includes **per-role quality dial**
recommendations — raise / lower / hold — grounded only in existing lean ledger
signals (BL-819/820). Pack conf is **never** rewritten by this slice.

## What the dial means

| Dial | Intent |
| --- | --- |
| `raise` | Role drove rework (bounces / stalls / …) → next shift should run hotter |
| `lower` | Role worked cleanly → cheaper/faster is fine |
| `hold` | No clear signal, or seat is on an **auto** window model |

Auto seats (`auto`, `cursor/auto`, `copilot/auto`, and equivalents) never get
raise/lower — only hold/skip. Provider auto already picks quality.

## Where it shows up

- Built into the ceremony packet / run record under
  `.swarmforge/lean/ceremony/<yyyy-MM-dd>.json`
- Specifier lean pass may refuse or reverse a recommendation (disposition
  `refused` / `held`) — advisory input only, not an automatic pack rewrite
- Coordinator still owns promotion order / throttle; quality dial is a third
  lever for the specifier packet

## Operator / specifier

1. Run `./finish-shift` (or the ceremony CLI) as today.
2. Read per-role dial rows with cited lean fields in the packet note.
3. Record `process_ticket` / `spec_gate_tweak` / `no_change` as today; treat
   dial rows as recommendations you may refuse.

## Out of scope (slice 2)

Auto-applying dial to pack overlay / window `--effort` or `--model`. Still
excludes auto models.

## Acceptance

`specs/features/BL-1119-closing-ceremony-role-quality-dial.feature`

Related: [BL-820 Closing-Ceremony Lean Pass](../reference/BL-820-closing-ceremony-lean-pass.md).
