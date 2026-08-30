# "to: specifier,coordinator notes only deliver to coordinator" — measured, premise falsified

Coordinator note `00_20260830T042445Z_003212` (priority 00), 2026-08-30:
*"recurring: to:specifier,coordinator notes only deliver to coordinator 2x"*.

**Disposition: no ticket.** Delivery is correct. What is actually suppressed is
the tmux WAKE, deliberately, and the file is delivered either way.

## Measurement

Every multi-recipient handoff addressed to both roles, counted in both mailboxes:

    specifier copies:   95
    coordinator copies: 95

Perfectly paired, `*_for_specifier.handoff` against `*_for_coordinator.handoff`,
across every dated pair from 2026-07-23 to today. Not one delivery is missing.

## Why it looks like a missed delivery

`handoffd.bb:533` splits `to` on commas and `doseq`es over EVERY recipient, so
each gets its own file. The wake is a separate decision, and `handoffd.bb:460-470`
suppresses it in three logged cases:

- `deliver-notify-skip-dedup` — `notified-sessions` is a per-message atom keyed
  by wake session, so two recipients resolving to one session are woken once.
- `deliver-notify-skip-dormant-note` — `suppress-dormant-note-delivery-wake?`
  suppresses the wake for a `note` to a DORMANT role. This is the designed
  behaviour behind PIPELINE.md's aged-note rule: a solo note to a dormant role
  is not actionable until `note_actionable_after_ms` (default 20 min).
- `deliver-notify-skip-busy` — the recipient's pane is mid-turn.

On a mono-router pack the specifier is usually dormant, so its wake is
suppressed while the coordinator (an always-on pane) is woken. From the
coordinator's seat that is indistinguishable from a lost delivery.

## What actually happens to the note

It waits in `inbox/new/` and is picked up by the specifier's next
`ready_for_next.sh`. Confirmed live today: the documenter's BL-1183 and BL-1240
spec-gap notes were both addressed to specifier+coordinator, both arrived in the
specifier inbox, and both were worked — alongside the coordinator's relays of
the same two, which were therefore redundant.

## For the coordinator

A note to a dormant specifier does not need relaying; it is already delivered.
If the concern is latency rather than delivery, the lever is
`note_actionable_after_ms` / a rotation, not a second copy. Relaying costs a
parcel each way and the specifier works both.
