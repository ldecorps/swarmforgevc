# Intake: a question the Operator could not answer

Filed by the Operator (2026-10-07T12:19:05.378495180Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Human ruling, verbatim: "Yes - mint a diagnosis ticket".

This is the ANSWER to a decision the SPECIFIER itself raised but never
routed - it only printed "Decision for you ...?" prose in its own pane
(nothing routes pane prose), so the Operator relayed it to the human as a
real poll at 2026-10-07 12:02Z (SUP-17). The human answered at 12:16:28Z.
The Operator does not mint; this is filed so the specifier can.

What to mint a diagnosis ticket for: the Telegram front desk - the human
operator's ONLY channel - is being stall-killed repeatedly with NO 409
involved. Cause unknown, and no ticket owns it.

Facts measured today (2026-10-07), from QA note 003907 and the front-desk
logs:
- 37 stall-kills on 2026-10-07 alone, none of them attributable to a 409
  (Telegram getUpdates conflict).
- They did NOT stop after the two approval-tap hotfixes landed: kills
  recurred at 11:32Z and 11:34Z, i.e. after both c416adc5fb and 4453766c28.
- The two latest kills each landed ~2 minutes after a FRESH bot start,
  which points the suspicion at startup or the first poll cycle rather
  than at steady-state polling.
- Blast radius today is delay, not loss: in the current explicit-queue
  setting (CURSOR_BRIDGE_INBOUND_QUEUE=1) an approval tap waits in
  Telegram across each restart. But every kill restarts the human's only
  channel, so the exposure is a dropped/garbled human round trip the
  moment that queue setting is not in force - which is exactly the state
  that caused the 10-06/10-07 lost approval taps.

Why this is NOT already owned:
- BL-2061 (paused) RECORDS this data (37 kills, no 409) and its qa_e2e
  step 5 was amended to stop expecting zero stall-kills (8f3b1c9900), but
  its subject is the cursor bridge DROPPING updates it has no route for
  while holding getUpdates. It does not diagnose why the front desk is
  stall-killed in the first place.
- BL-2060 stamps the two QA hotfixes. Nothing in backlog/active or
  backlog/paused owns the stall-kill cause.

The specifier owns scope, id and priority as usual - the Operator is not
proposing acceptance criteria. The one thing worth carrying in: the
~2m-after-fresh-start timing is the most specific lead we have, so a
diagnosis ticket that instruments front-desk startup and the first poll
cycle (and distinguishes a stall-detector false positive from a real
hang) would answer it without first having to re-derive the 37-kill
measurement.

## Disposition (specifier, 2026-10-08)

Drained to **BL-2072** (`backlog/paused/BL-2072-a-front-desk-stall-names-the-phase-that-stalled.yaml`,
minted 924993472f): the human had already chosen "Mint a diagnosis ticket"
in the specifier's own session, and BL-2072 is that diagnosis slice - it
instruments the startup topic checks, the getUpdates wait and batch
handling, which is the ~2m-after-fresh-start lead this intake carried.
The human's verbatim answer above is now in BL-2072's `source:`.
