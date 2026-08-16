# Raw intake — Projected ETA on the morning-briefing not-done burndown chart

Status: new intake, not minted. Capture only (human via Cursor 2026-08-16
~08:20 CEST). Same turn as the Flagged #1 ruling on BL-896: the human now
wants the briefing burndown kept **and** a projected ETA on it.

Parent / sibling: BL-896 (stamp-off of hotfix `14724edae7`, already active).
Do **not** fold this into BL-896 — that ticket is a review stamp (F1–F4);
this is new product. Mint a small follow-on.

## Goal

Show a projected ETA on the morning-briefing not-done / burndown chart
(open tickets remaining), not only the trailing 30-day line.

## Locked human decisions

1. The chart stays. The 2026-07-26 PWA/milestone-burndown ban does not apply
   here (recorded on BL-896).
2. Keep calling it a burndown on the heading.
3. Add a projected ETA the human can read at a glance (caption and/or a
   dashed projection). Never invent a date when net flow is still growing.

## Specifier should decide (defaults welcome)

- **How to compute ETA.** Suggested default, using numbers the series
  already has (`openN`, `closePerDay`, `mintPerDay`): net burn =
  close − mint. If net burn > 0, etaDays = openN / netBurn, shown as a
  calendar date. If net burn ≤ 0, render "no ETA — backlog still growing"
  (never "never", never a fabricated infinity).
- **Whether to reuse BL-228's deliveryMetrics forecasts** (p50/p85 of
  remaining *tickets*) vs the simple net-flow projection above. Default:
  net-flow, because this chart is repo-wide open count, not milestone
  remaining. Do not silently introduce a second disagreeing ETA.
- Caption vs overlay line vs both.

## Out of scope

- Re-adding burndown to the PWA dashboard (still under BL-659).
- Recertifying hotfix `14724edae7` (BL-896).
- Changing how open/filed/closed points are counted (F3 of BL-896).

## Requested outcomes

1. Minted ticket with Gherkin: growing backlog shows no fabricated ETA;
   shrinking backlog shows a date derived from the declared method.
2. The next morning briefing PNG/caption carries that ETA.
