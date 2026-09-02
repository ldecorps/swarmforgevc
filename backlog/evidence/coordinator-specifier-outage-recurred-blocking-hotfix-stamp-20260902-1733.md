# Specifier outage RECURRED — 5 parcels stuck, hotfix stamp note explained — 2026-09-02 ~17:33

## Trigger
Self-note in_process again: "hotfix 27d6ab8630 has no stamp ticket - mint
a review ticket for it" (same as the 16:32 occurrence). Ledger row still
`state: pending, stamp_ticket: null` — nothing minted.

## Root cause found
Per [[coordinator-specifier-pane-duplicate-coordinator-20260902]] (this
exact bug, first caught ~13:48 today), checked current staffing:

```
tmux list-panes -a -F "#{session_name} #{pane_pid}"
swarmforge-specifier 11834
ps -o cmd= -p 11834 -> zsh .../launch/coordinator.sh   (NOT specifier.sh)
```

**Confirmed recurrence**: the `swarmforge-specifier` pane (this launch,
tmux sessions created 16:34:19 — a DIFFERENT, later launch than the one
diagnosed at 13:48) is again running a duplicate `coordinator.sh`, not
`specifier.sh`. No specifier process exists anywhere in this tmux server.
Captured its pane content directly — it is a second coordinator session
(discussing coordinator-scoped things, even a "can you upgrade to fable"
aside), not specifier work.

This explains the WHOLE session's specifier backlog:
- `specifier/inbox/new/` currently holds 5 unclaimed parcels, oldest from
  16:33 (`.chase.json` shows `chaseCount:2`, already auto-chased twice by
  the daemon with no pickup): my BL-848/root-intake routing note, my
  babysitter-ack-gap note, a hardender→specifier note, a coder→specifier
  note, and a QA→specifier note.
- The earlier "specifier self-corrected Article 1.2" work
  (`3310a24dfb`, BL-1341 mint) that landed EARLIER today was real — a
  genuine specifier was staffed and working before this 16:34 relaunch
  re-broke it.

## Minimal correct action taken
- Did NOT hand-edit tmux/process state (BL-107 discipline — killing/
  respawning panes myself risks killing the wrong process, possibly this
  session).
- Re-wrote the sanctioned `.swarmforge/bounce` sentinel (content `swarm`)
  to request a proper relaunch. Noting: the SAME sentinel written at 13:50
  today is still sitting unconsumed — `bounce-ack.json` last updated
  2026-08-22, 11 days stale — strong evidence no extension host is
  currently listening for this sentinel at all. Re-writing it is the
  correct sanctioned action regardless, but it may not self-resolve.
- Attempted `role_ask.bb` escalation — refused, a coordinator question is
  already pending (from the earlier 13:48 diagnosis, still unanswered).
  Not duplicating.
- NOT minting the BL-848 stamp ticket myself (Article 1.2/1.1 — that's
  specifier's job, and I already correctly routed it once). Completing
  this self-note task as-is; the underlying block is the specifier outage
  documented here, not a new coordinator action.

## For the human
Two things need a human hand, in order of urgency:
1. **Specifier is unstaffed** (again) — 5 parcels queued, growing. The
   bounce-sentinel path appears non-functional (unconsumed 11+ days). A
   direct respawn of the `swarmforge-specifier` pane (or investigating why
   the launcher keeps assigning `coordinator.sh` to that pane) is likely
   the fastest fix.
2. This is now a **repeat launch-assignment bug** (2nd occurrence today,
   two different launches: 13:18 and 16:34) — worth a ticket once a real
   specifier is staffed to write it, since I should not mint tickets
   myself.

By coordinator.
