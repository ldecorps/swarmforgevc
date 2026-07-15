# Intake: amend BL-423 (phone swarm control) — timed pause + stop-mode split

Filed by the coordinator (2026-07-15) — human follow-up on BL-423
(`backlog/paused/BL-423-telegram-swarm-control-verbs.yaml`, still unpromoted,
not yet held by any role), verbatim via Telegram/voice-to-text: "15 min...
like dropbox does. As well as stop gracefully (drain) or emergency stop."
This is a RAW ask, not a spec: the specifier drains this like any other
backlog-root item, amending BL-423 in place since nobody has started work on
it yet (no merge-up/holder notification needed per the in-flight-amendment
rule — the ticket has no holder to notify).

## Reading of the ask (specifier to confirm/refine with the human if ambiguous)

1. **Timed pause, "like Dropbox does"** — Dropbox's sync-pause control offers
   a short menu of durations (e.g. 15 min / 1 hr / 24 hr / until I resume) and
   auto-resumes when the timer elapses. The human wants an equivalent for the
   swarm: a phone-driven "pause for 15 min" (durations TBD by specifier,
   15 min at minimum) that auto-resumes on its own, distinct from an
   indefinite /stop. Likely rides the same guarded control topic BL-423
   already specs.
2. **Split /stop into two modes** — BL-423's current spec has one /stop verb
   ("a clean teardown, no orphaned tmux windows/vitest workers"). The human
   now wants that distinguished explicitly as a GRACEFUL/drain stop (let
   in-flight work finish, then teardown) versus an EMERGENCY stop (immediate,
   no drain wait) — two guarded verbs (or one verb + a modifier), both still
   behind BL-423's existing confirm-gate and control-topic/principal guards.

## Scope note for the specifier

BL-423 already depends on BL-410 (inline-keyboard buttons) and is not yet
promoted — fold this in as an amendment to the same ticket rather than a new
one, unless splitting it out avoids stranding the base /stop+/restart pair
(the ticket's existing "ship both verbs together, never stranded" constraint
from the human's earlier AskUserQuestion answer still applies).
