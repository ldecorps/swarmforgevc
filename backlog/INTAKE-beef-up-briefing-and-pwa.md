# Intake request (operator, 2026-07-10, via coordinator) — DIRECTION, propose first

## Beef up the "daily meeting" (daily briefing) and the phone app (PWA)

**Operator ask (broad direction, not a single feature):** expand and strengthen
the daily-briefing and phone-app feature sets. This is a theme to develop, not one
ticket.

**INTERPRETATION TO CONFIRM:** "daily meeting" is read as the **daily briefing**
(the committed `docs/briefings/<date>.md` emailed by the handoff daemon via
`briefing_email_lib.bb`, carrying the coordinator's optimizer recommendations).
If the operator means a NEW distinct "daily meeting / standup" surface, confirm
before speccing.

**HOW TO HANDLE (specifier):** do NOT fan out a pile of tickets. First **propose a
shortlist** of concrete, high-value enhancements in each area (a few per area,
each one-line + why), route it back to the operator via the coordinator for
selection, and only spec the ones the operator picks. Keep proposals ADDITIVE —
build on what exists, don't duplicate shipped features.

**Current baseline — what already exists (build beyond these):**
- Daily briefing: date-stamped headline subject, coordinator optimizer-recs
  section; BL-251 (in queue) adds a "needs human approval" list; BL-252 (building)
  adds a unit-test suite-duration trend + regression flag.
- PWA: backlog dashboard (BL-097); docs drill-down milestone→ticket→Gherkin
  (BL-117); Gherkin recertification confirm/update/delete (BL-150); implemented-vs-
  not-yet greyed tree (BL-253, done); full-text spec search (BL-254, done);
  approval-list (BL-251, queued); suite-duration trend (BL-252, building);
  localization (BL-229/230); accessibility (BL-238).

**Candidate directions to consider (seeds, not a mandate — specifier proposes):**
- Briefing: richer per-stage throughput/dwell metrics; QA-bounce and chase trends;
  token/cost per stage when telemetry exists; a "what merged / what's blocked"
  digest; links into the PWA views.
- PWA: surface the same briefing metrics as live trends; per-ticket timeline;
  filter/search over the backlog (not just docs); a "what changed since last visit"
  view; push/notification hooks (respecting the no-heartbeat MVP scope boundary).

**Constraints:** stay inside existing boundaries — briefing derives from committed
git-visible state + existing telemetry (machine-local data stays out of the
git-projection per BL-252's boundary); PWA reads `backlog.json`/`docs-tree.json`
(no new authoritative store), webview is presentation-only, strings localized.
Anything crossing the Milestone-1 scope line (watchdog, push bus, cost tracking)
is flagged for operator decision, not assumed.

**Priority:** normal (operator did not mark top-priority).

_Specifier: propose the shortlist first; spec only what the operator selects. Then
remove this intake file._
