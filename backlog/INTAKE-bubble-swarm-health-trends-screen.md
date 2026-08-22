# Raw intake — Bubble screen: swarm Health / trends (efficiency over ~2 weeks)

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket. Picture mock emailed to notify_email_to the same evening
for phone review. Persisted for specifier/coder (copied into repo 2026-08-01):
`docs/design/bubble-health-trends-screen-mock.png` (layout v1) and
`docs/design/bubble-health-trends-REAL-data-mock.png` (same layout with
live telemetry numbers from 2026-07-31).

Related
- Same evening: Workflow Canary intake (tracer bullet → Canary). Canary
  runs and hop traces are one future feed; this screen is the broader
  multi-day health view.
- Earlier Bubble pager intakes (Talk, Notes, Control, Live, Pipeline,
  clarification). Pipeline board intake said it was the last screen in
  that batch; human later asked for **yet another** screen — this one.
- Existing metrics already computed for bridge / holistic UI / PWA /
  briefing: cycle time, velocity, burndown, stage-dwell, suite-duration
  trend, cost & health, rework / bounce signal (BL-430+) and diagnosis
  (rate vs baseline). Prefer reuse over a second metrics engine.
- Mini App / PWA / holistic already show pieces of this; Bubble should
  become the phone glance surface. Mini App retirement policy from the
  Pipeline intake still applies: cutover later, dual-run OK for v1.

## Goal

A Bubble pager screen that shows how well the swarm has been working over
a recent window (human ballpark: about two weeks; exact default open).
Glanceable trends and rates so the operator can see what to optimize:
how long tickets take to traverse, how often work bounces back, and other
meaningful efficiency / health metrics — a phone health dashboard, not a
laptop dig.

## Problem

- Operator wants to know if the process is getting faster or slower, and
  where waste is (bounces stretch traverse time).
- Pieces exist on bridge holistic UI, static PWA, daily briefing, and
  CLIs, but Bubble has no dedicated trends / health page.
- Without a phone view, “is the swarm healthy this fortnight?” stays a
  laptop or email chore.

## Why this matters

- Bounce count and traverse time are linked: more bounce-backs usually
  means longer ticket lifetime. Surfacing both (and related signals)
  makes optimization obvious.
- Two-week window is long enough to see patterns, short enough to act.
- Supports the same optimization loop the Canary proves hop-by-hop:
  Canary = “does the chain work tonight?”; this screen = “has the
  process been efficient lately?”

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Another Bubble screen.** Same expanded-Bubble pager family as the
   other evening intakes (not a separate app).
2. **Window.** Roughly the past two weeks as the working mental model;
   specifier picks default (e.g. 14 days) and whether the human can
   change the window in v1.
3. **Core questions to answer.** At least:
   - Average (or median / p85) time for a ticket to traverse the swarm
     (cycle / lead time style).
   - Bounce-back volume / rate (rework), because more bounces inflate
     traverse time.
   - Other meaningful metrics for “what could be improved” — specifier
     proposes from existing instruments (stage-dwell bottlenecks,
     velocity, suite-duration creep, rework diagnosis, cost/health
     anomalies, Canary pass rate once Canary lands, etc.). Do not invent
     vanity charts with no action story.
4. **Purpose.** Optimization and efficiency visibility — not live
   in-flight placement (that is Pipeline) and not start/stop (that is
   Control).
5. **Name flexible.** “Health”, “Trends”, “Metrics”, or similar — pick
   one clear Bubble page title; human did not lock the label.
6. **Reuse existing metric sources.** Bridge `/metrics`, `/stage-dwell`,
   cost-health / rework sidecars, briefing fields — Bubble reads, does
   not re-derive conflicting numbers.

## Requested outcome

1. Bubble Health (or Trends) page over a ~14-day default window.
2. Traverse-time summary (median/p85 or equivalent already computed).
3. Bounce / rework summary (counts or rate; split by bouncing role if
   the existing signal already does — do not pool QA and architect into
   one misleading number if we already split).
4. A small set of additional actionable trend readouts specifier
   selects from existing metrics (bottleneck stage, velocity, suite
   duration warn, rework-vs-baseline verdict, etc.).
5. Honest empty / cold-start state when the window has no data.
6. How-to line when shipped; Mini App overlap deprecation later if any.

## Acceptance shape to refine

1) Open the Health/Trends page on Bubble → see traverse-time and bounce
   signals for the configured window without opening a laptop.
2) Numbers match the same computation as bridge/CLI for the same window
   (no second formula).
3) At least one “where to look next” signal beyond raw bounce count
   (e.g. bottleneck stage or rework diagnosis) when data exists.
4) No data → clear empty state, not fake zeros that look healthy.
5) Page is reachable by swipe in the expanded Bubble pager.

## Out of scope

- Minting without specifier disposition.
- Replacing Pipeline (in-flight grid) or Control (verbs).
- Building a new metrics warehouse or long-term analytics DB in v1.
- Editing tickets or drilling into full git blame from the phone in v1
  (detail drill optional later).
- Immediate Mini App / holistic deletion.

## Suggested type / priority hint for mint

- type: feature (Bubble UX + bridge metric endpoints / existing
  sidecars)
- mutation_cost: medium–high (Android page + bridge payloads + window
  param; Android acceptance-seam / BL-761 sequencing applies)
- Sequence after or beside Pipeline/Live ports; depends on metric APIs
  already present more than on Canary epic (Canary pass-rate is a
  nice-to-have later feed)
- Not offline expeditor unless the human asks

## Specifier: please weigh in

Open questions the human did not fully lock:
- Exact page title: Health vs Trends vs Metrics vs Efficiency.
- Default window 7 vs 14 vs 30 days; user-selectable in v1?
- Chart vs number-first layout on a small phone (human asked for
  “dashboard” feel but Bubble is tiny — sparklines vs big numbers).
- Which third/fourth metrics are in v1 vs later (stage-dwell,
  velocity, suite duration, cost anomalies, Canary pass rate).
- Pager order relative to Pipeline / Live / Control.
- Whether bounce “same as longer traverse” is shown as one combined
  insight card or two separate metrics (human noted they are linked).

---

## specifier_disposition

**2026-08-01 — NOT drained. Parked with the other Bubble intakes, same blocker.**

This is the twelfth Bubble screen intake, and it inherits the block the other
eleven carry: the repo cannot yet write an *executable* acceptance contract for
Android behavior. There is no `test`/`androidTest` source set under `android/`,
no `testImplementation` dependency, and the Node acceptance runner cannot reach
Kotlin. Speccing Gherkin that no runner can execute is precisely the defect
BL-761 exists to stop, so drafting scenarios here would produce a contract that
looks green and proves nothing.

**Resume point:** BL-769 (Android pure-logic JVM unit seam) must *ship*, not
merely be promoted. As of this writing BL-769 sits in `backlog/paused/` reading
`human_approval: pending` — verified against `main` today, so it is not even
promotion-eligible yet. When it lands, re-check that this intake is genuinely
unblocked rather than assuming it.

**Separately blocked on a question slot.** The human explicitly asked the
specifier to weigh in on six open choices (page title; window default and
whether it is user-selectable; chart-vs-number layout on a small screen; which
third/fourth metrics are v1; pager order; whether bounce and traverse time are
one combined insight card or two). `role_ask.bb` permits ONE pending question
per role and the specifier's slot is currently held by the unresolved
"use staging please" question (asked 2026-08-01 05:53). `GH-29` was already
recorded as first in line for the next free slot, and the JumpQ steering
escalation (see `backlog/STEERING.md`, 2026-08-01 review row) now precedes both.
This intake is third in the ask queue.

**Not challenged.** The six human decisions locked on 2026-07-31 are all sound
and are carried forward verbatim when this is minted. In particular decision 6
(reuse bridge `/metrics`, `/stage-dwell`, cost-health and rework sidecars rather
than deriving a second set of numbers) matches the acceptance shape's own point
2 and should become an explicit ticket invariant at mint time: *every figure the
screen shows is read from the same computation the bridge and CLI already use
for that window — the screen never re-derives a metric.*
