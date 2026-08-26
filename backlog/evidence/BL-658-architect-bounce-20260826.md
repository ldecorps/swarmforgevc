# BL-658 — architect bounce — 20260826

- merge_and_process cleaner tip `dfed8a184f` (clean merge).
- dependency-gate on parcel sources: **PASSED**.
- Pure core + property encoding for the fixture runner look sound; APS
  scenarios exercise `runClosingCeremony` sequences.
- `node --test` nightClosingCeremony(+Gate): 13/13; properties: 2/2;
  `test_handoffd_closing_ceremony_gate_wiring.sh` PASS (suppresses fixed
  morning under `closure_stop_local`).

## Inventory (one bounce)

### D1 — behavior: ceremonyDue is log-only; scheduled path produces no briefing

**Sites**

1. `swarmforge/scripts/handoffd.bb` `briefing-generation-sweep!` — when
   `mode=ceremony` and `ceremonyDue`, only `(log! "closing-ceremony-due" …)`;
   no freeze / drain / rotate-to-documenter / briefing instruct / send verify /
   night-stop.
2. No live adapter invokes `runClosingCeremony` (module comment admits IO
   adapters are "outside this pure core"; none shipped for the sequence).
3. Consequence: with conf `closure_stop_local` set (this swarm's path), the
   gate correctly sets `consultFixedMorningTrigger: false`, retiring the
   interim 04:30 clock, **without** producing the morning briefing as the
   closing sequence's last act. That recreates the silent-mailman class the
   ticket exists to remove — only via a different door.

**Required remediation**

Wire the live closing sequence at the handoffd consultation site (or a
dedicated driver it calls) so that when the gate reports ceremony mode and
due: promotion freezes, in-flight drain (or clean park), documenter briefing
parcel (happy-days chain when already there), send confirmation via
`.sent.json` (not file-exists), then night-stop — before or as the hard
backstop. Logging `closing-ceremony-due` alone is not the ticket.

Ticket invariant + required_wiring: consulting the gate is necessary but not
sufficient; the briefing must be produced as the ceremony's last act on the
closure-scheduled path.

## Not bounced (noted)

- `shouldConsultFixedMorningTrigger` ≡ `fixedMorningTriggerFires` for the
  three-state schedule enum (cleaner note) — DRY nit for hardener/coder
  after the live sequence lands, not this bounce.
- Cron install/regen deferred per ticket edge-6 notes — OK as sibling scope.

Bounce → coder (`behavior`).

By architect.
