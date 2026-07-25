# Human directive — morning briefing must warn when projected token burn outruns the weekly reset

**From:** human, via Concierge Telegram topic 06:39Z 2026-07-24 (message was
silently dropped by the front desk — photo-caption defect, separate intake —
re-filed verbatim by the operator from the screenshot)
**Route to:** specifier

## The directive (near-verbatim)

"Add a warning (in morning briefing at least) if projected burn rate is too
high. Like it is the case [now]. At that rhythm, we will run out of tokens
before Thu 7am. So human has to stop using tokens, or swarm has to slow down."

## Context from the attached usage screenshot (2026-07-24 ~06:39Z)

- Weekly limits: All models 23% used (resets Thu 7:00am), Fable-only 15% used
  (resets Thu 6:59am)
- Credits: monthly spend limit £40.00, balance £7.60
- The human's projection: at the current rhythm the weekly allowance is
  exhausted BEFORE the Thursday reset — the warning must fire on the
  PROJECTION, not on crossing a static threshold.

## What to spec

A burn-rate projection in the morning briefing (at minimum; specifier decides
if it also warrants an immediate alert channel): given usage-so-far in the
current weekly window and the time remaining to reset, project exhaustion
time; if projected exhaustion falls BEFORE the reset, the briefing leads with
a warning naming the projected run-out time and the implied choice (human
pauses usage, or swarm throttles). Note the swarm already has cost/usage
telemetry surfaces (BL-594 trends epic, cost-substrate cluster) the specifier
should reuse rather than duplicate; whether the swarm can READ the account
usage percentages programmatically is a real open question the spec must
answer (the screenshot is app-side data — if no API exists, spec the nearest
proxy from local telemetry and say so explicitly).

The human closed with: "I hope you have vision to see the picture" — the
front desk does NOT have vision; this intake transcribes the picture. If
image-bearing messages matter going forward, see the caption-drop defect
intake filed alongside this one.
