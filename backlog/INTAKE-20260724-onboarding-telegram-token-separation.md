# Human-confirmed incident — onboarding cloned the Telegram bot token; a rival poller silently stole inbound messages for ~9 hours

**From:** operator rc session, incident confirmed with the human, 2026-07-24 ~02:35Z
**Severity:** high (human→swarm channel silently dead; no local alarm fired)

## What happened

Two human Telegram messages went unanswered (coordinator topic ~21:45Z Jul 23,
concierge topic ~02:10Z Jul 24). Diagnosis chain, all verified live:

1. Local front-desk bot: correct token/chat/principal env (fingerprint-matched
   against `/proc/<bot>/environ`), correct routing (synthetic principal message
   replayed through compiled `decideUpdateAction` → `open-default`/`open-for-topic`,
   never `drop`), `pending_update_count: 0`.
2. Yet the supervisor log shows all-evening `poll degraded - 5 consecutive
   failures` streaks with NO cause — `applyPollCycleResult`'s degraded warning
   DISCARDS the underlying error, and the poll heartbeat stamps on failed
   cycles too (BL-370, by design), so the outage looked green.
3. Decisive down-probe (procedure per operator memory): front desk fully
   stopped, 40s long-poll grace, ONE `getUpdates?timeout=3&limit=1` probe →
   **409 Conflict with our client dead = a REAL external poller on this token.**
4. Human confirms an **onboarding attempt** was made (possibly from the old
   Mac, same wifi). The onboarded swarm's front desk cloned the SAME
   `TELEGRAM_BOT_TOKEN` and has been stealing `getUpdates` — consuming and
   acking this swarm's inbound messages — since ~17:30Z Jul 23 (last
   provably-working inbound: the BL-589 approval, 17:16Z).

Last provable inbound before the theft window; front desk restarted cleanly
afterward on this box (it still fights the rival until the rival is killed —
human action, other machine).

## What to spec (specifier: likely 2-3 tickets)

1. **Onboarding token separation (root cause).** The onboarder / second-swarm
   bring-up must NEVER clone `TELEGRAM_BOT_TOKEN` (or the front-desk enable
   state) into a new swarm. A fresh swarm gets its own bot token + group, or
   comes up with front desk DISABLED until a human provides one. One token has
   exactly one poller — this is a Telegram API invariant, not a preference.
   Extends the existing multi-swarm GROUP-separation finding to TOKEN
   separation. (Related: FES bring-up, BL-590 onboarder ruling, BL-262
   onboarding contract.)

2. **Degraded-poll observability defect.** `poll degraded - N consecutive
   failures` must carry the underlying error (a 409 Conflict names a rival
   poller in one log line — 9 hours of anonymous streaks hid this). Also
   consider: a sustained-degraded state (e.g. >30 min) should escalate to the
   human like stuck-delivery does, since heartbeat freshness deliberately does
   not distinguish success from handled failure.

3. **(Smaller) drop-outcome audit trail.** `dropped` update outcomes are
   silent by design; a one-line reason log (already computed in
   `checkUpdateEligibility`) would have cut this diagnosis from hours to
   minutes without changing behaviour.

## Evidence

- `.swarmforge/operator/front-desk-supervisor.log` — degraded streaks, no cause
- Probe result 409 with local client stopped (operator session 2026-07-24)
- Operator memory: telegram-409-is-self-inflicted-not-second-poller (now
  carries the counter-case + the distinguishing procedure)
