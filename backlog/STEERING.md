# Kanban Steering Policy (BL-138)

The specifier owns this file. It declares ONE active strategic direction per
cycle, the classification of every backlog ticket against that direction, the
pull/WIP rules the coordinator applies when promoting work, and the review
cadence that is the only sanctioned way to change direction.

## Current direction

- **Direction:** NONE — `reliability-first` was RETIRED at the 2026-07-13 review,
  having met its target. No direction is currently declared, pending the human's
  choice of the next one (see "Awaiting the human" below).
- **Effect while no direction is declared:** the Direction lane imposes NO
  restriction. Every ticket is eligible for pull on the ordinary rules —
  bugs/expedite first, then by priority, with orthogonality and the hard WIP cap
  unchanged. A retired direction must never keep silently vetoing work: an
  expired policy is not a policy.

### Retired: `reliability-first` (2026-07-06 → 2026-07-13) — target MET

- **Was:** harden the pipeline before building on it; the competing themes (phone
  UX, multi-agent abstraction, concurrent swarms) all sit on that substrate, and
  investing in them while the substrate loses work is rework waiting to happen.
- **Target metric was:** ≥ 80% of parcels passing QA first attempt, AND the count
  of open BUG-titled tickets decreasing at each weekly review.
- **Outcome:** all TEN tickets in its declared prioritized slice are closed
  (BL-107, BL-115, BL-116, BL-125, BL-126, BL-127, BL-131, BL-135, BL-136,
  BL-137) — open declared-bug count 7 → 0. The reliability backlog is drained:
  at review time there were ZERO `aligned` and ZERO `expedite` candidates left
  anywhere in `active/` or `paused/`. The direction had nothing left to prefer,
  and its only remaining effect was to block the work the human was asking for.

## Awaiting the human — the next direction

The specifier does not pick the strategic theme unilaterally when the human is
present and the choice is genuinely discretionary. The evidence from this cycle
points at two candidate themes, and the human has pushed on BOTH:

- **cost-control** — "we have to reduce costs" (2026-07-13). Agent COUNT is the
  dominant lever: BL-324 (park unneeded roles), BL-318 (make auto-hibernate
  reachable), BL-319 (cheaper coordinator backend), BL-101 (headless secondary
  swarms).
- **human-in-the-loop / front-desk trust** — the swarm asked for approval, threw
  the question away, could not hear the answer, and proceeded without the human
  (BL-325); a topic still opens with a bare `TaskStarted` (BL-322, asked for
  twice).

Until the human declares one of those as the cycle direction, no Direction-lane
gate is in force. That does **not** mean the human has said nothing about
product surfaces — see the standing freeze below.

## Standing human freeze (2026-07-30) — one Bubble over Telegram / PWA clients

**Naming note (same day):** **messaging** and **host agent** are the architecture
interfaces; **Telegram** and **Cursor** remain the everyday incarnations. The
phone app’s product name is **Bubble** (not Float Companion in new prose). The
policy is Architecture Rule 7 in
`swarmforge/constitution/articles/local-engineering.prompt` (a rename sweep off
Telegram/Cursor is out of policy); the docs half is BL-711.

**Human directive (Cursor session, 2026-07-30):** stop investing in **new
Telegram** product/UI work. Ramp the **phone app** instead.

**Settled (same day):** **one app** — **Bubble** (`android/`, BL-707).
Migrate into it:

1. **Pages PWA** surfaces (backlog dashboard, docs browser, pipeline board /
   groom) — offline tube/plane reading lives here
2. **Telegram Mini App** operator console (Let's Talk + related mini-app
   chrome) — talk/control lives here; Mini App is not grown as a peer client

### Bubble migration checklist

- [x] ~~Let's Talk Mini App screen~~ — retired 2026-07-30; talk UX is **Bubble**
  only. Bridge keeps `POST /lets-talk/turn`, `/new-session`,
  `/lets-talk/chiptunes.json`, and a `GET /lets-talk` health stub for
  watchdogs. Console menu no longer links a Mini App Let's Talk page.
- [ ] Pages PWA (backlog / docs / board / groom) → Bubble panels
- [ ] Remaining Mini App console slices (pipeline grid, etc.) → Bubble as needed

Bubble began as a chatbox; it became a native app to float; it is now the
**full operator phone**. Pages `pwa/` + JSON artifacts and the bridge Mini App
shells remain **package / protocol sources** (and temporary fallbacks) until
parity — not destinations. See
`backlog/hold/INTAKE-phone-wire-format-and-offline.md` (human-held: it is
blocked on three answers, not on engineering — the file names which answer
unblocks which slice).

Prefer / pull toward:

1. **Bubble** — single install (talk + backlog/docs/groom + console
   capabilities migrating from Mini App)
2. **Package / bridge contracts** — `backlog.json`, `docs-tree.json`, Let's
   Talk routes, chiptunes / companion-manifest the app syncs while online
3. **Maintain-only** on Telegram Mini App and Pages PWA UX — fix expedite
   defects; do not add features whose only home is those clients

**Do not promote or mint** tickets whose primary deliverable is a new Telegram
bot feature, topic UI, board chrome, or mini-app-in-Telegram page — unless the
human tags them `human-requested` or they are a true `expedite` defect that
breaks an already-shipped Telegram path (front desk deaf, control verbs broken,
etc.). Operator slash verbs and the host-agent control topic that already shipped stay
maintainable; they are not a license to grow the Telegram surface further.
(2026-07-30 human note: that topic was renamed in Telegram from "Cursor Remote"
to "Host"; intake filed as `INTAKE-rename-cursor-remote-topic-to-host.md` so code
and copy can catch up — maintain rename only, not new Telegram surface.)
Same for Pages-PWA-only feature work once Bubble parity is the ramp.

**Human directive 2026-07-31 (Let's Talk, morning):** for **today's live
shift**, prefer the **pilot-process** defect batch from BL-723 (roughly
BL-727…BL-757 process half, plus orphan-doc companion BL-756) — already
tagged `direction: queue-jump`, `priority: 0`, `human_approval: approved`.
Do these on the **live swarm**, not `/pilot`. Goal: harden pilot close gates
before more safe-pilot volume. Ordinary paused work waits behind this batch
unless a true high/critical operational defect must jump first.

**Same day, JumpQ order (Let's Talk):** after that priority-0 evidence-gate
slice, pull **BL-758** (`direction: queue-jump`, `priority: 1`) — inject each
pipeline role's real prompt at hat change instead of one mega-brief. Same
batch, gates first, root staffing shape second. Still live swarm only.

**Human directive 2026-08-01 (Let's Talk, morning) — the SECOND ask.** "When
BL-764 leaves `active/`, promote the JumpQ pilot-process slice next... Do not
keep pulling Bubble/adopt or ordinary paused work ahead of that hardening."
BL-764 closed to `backlog/done/M8/` earlier today, so the gate the human named
has opened. This file's own Classification rule says an item the human has to
ask for **twice** is a defect in THIS FILE, not a queue working as intended —
so it is escalated as a steering review below rather than passed to the
coordinator as one more promotion hint. The raw intake
(`INTAKE-resume-jumpq-pilot-process-after-bl764.md`) is drained into this
section; its substance is carried here in full.

**Human directive 2026-07-31 (Cursor, evening):** **continuous shifts until
revoked.** Keep the pack up across former day/night boundaries — no scheduled
`night-stop` / `day-shift-end`. Crontab ensure-up only (09:00 + 17:00). State:
`.swarmforge/operator/continuous-shifts.json`. Do not restore
`crontab.night-standing` or lights-out the stack on a timer until the human
says otherwise. Operator note:
`.swarmforge/operator/INTAKE-continuous-shifts-until-revoked.md`.

This freeze is stronger than "Awaiting the human" silence: it is an explicit
veto on a class of work, recorded here so specifier/coordinator do not keep
pulling Telegram / PWA-client UX by inertia while Bubble is the stated
ramp.

## Classification

Every ticket in `backlog/active/` and `backlog/paused/` carries a
`direction:` field with one of:

- `aligned` — advances the current direction; eligible for normal pull.
- `non-aligned` — valid work for a different theme; stays paused this cycle.
- `expedite` — defect or operational blocker; eligible for pull regardless
  of direction (bugs-first standing order is unchanged).
- `human-requested` — the human explicitly asked for this ticket. Eligible for
  pull regardless of direction, ranked alongside `expedite`. **STEERING may
  order the work the human has not prioritized; it may never veto the work the
  human HAS.** (Added at the 2026-07-13 review. BL-322 was asked for TWICE and
  could not be pulled: it was `non-aligned`, the single non-aligned lane slot
  was held by BL-324, and so the policy silently starved an explicit human
  request. Reclassifying it as `expedite` would have been the easy escape — and
  a lie, since it is a UX feature and not a defect. The honest fix is that the
  policy was missing a value, not that the ticket was mislabelled. Do not
  launder a human request through `expedite`; tag it for what it is.)
- `queue-jump` — a batch the human named explicitly and asked to be pulled
  ahead of ordinary paused work. Semantically a sub-case of `human-requested`,
  minted 2026-07-31 for the BL-723 pilot-process batch and used on 20 paused
  tickets before this file ever defined it. **It ranks alongside
  `human-requested`: ahead of `aligned` and `non-aligned`, and NOT ahead of an
  Article 3.2.4 expedited defect.** That last clause is a constitutional limit,
  not a preference — see the 2026-08-01 review row for why it matters and what
  it costs.
- If the human has to ask for the same ticket twice, treat that as a DEFECT IN
  THIS FILE, not as a queue working as intended. Escalate it as a steering
  review, not as a promotion decision.

Rules:

1. The specifier tags every new spec with `direction:` at spec time, judged
   against the direction current at that moment.
2. Non-aligned tickets are not promoted while the direction holds, unless
   reclassified as expedite (a defect/blocker discovered in them).
3. Classification applies at PULL time. Work already in `backlog/active/` or
   in flight when a direction is declared is grandfathered: it finishes
   normally and is never yanked mid-pipeline.
4. Reclassification outside a review happens only when facts change (e.g. a
   ticket turns out to be a defect); the specifier commits the retag with a
   one-line reason.

## Pull policy (coordinator applies at promotion time)

- **Hard cap:** `active_backlog_max_depth` in `swarmforge.conf` (read the
  current value each time) remains the absolute WIP ceiling.
- **Direction lane:** at most ONE active slot may hold a `non-aligned`
  ticket, and only when no orthogonal `aligned`/`expedite` candidate exists.
  All other slots pull `expedite` first (bugs-first), then `aligned`, by
  priority.
- **Full rank order** (apply top to bottom; within a tier, ticket `priority:`
  ascending, orthogonality applied at every tier):
  1. Article 3.2.4 expedited defects — `type: defect` with `severity: critical`
     or `high`. Constitutional; STEERING cannot reorder this tier.
  2. `queue-jump` / `human-requested` — work the human named explicitly.
  3. `aligned`.
  4. `non-aligned`, one slot only, per the Direction lane above.
  A ticket with no `severity:` is NOT expedited: the lane fails closed
  (Article 3.2.4) and the ticket is surfaced for triage, never guessed upward.
- **Orthogonality:** the Concurrent Work Orthogonality rule (constitution,
  workflow article) is unchanged and applies within the lane.
- **Definition of Ready** (a ticket may not be promoted unless all hold):
  1. `id`, `milestone`, `priority` present;
  2. prose `description:` stating what/why/constraints;
  3. Gherkin `acceptance:` scenarios;
  4. `direction:` tag present;
  5. scope orthogonal to everything currently in flight.

## Review cadence

- The direction is reviewed WEEKLY by the specifier (next review:
  2026-07-13), or immediately on an explicit operator request.
- Each review records a row in the log below: keep or change, plus the
  evidence consulted (metric readings, bounce counts, open-bug delta).
- If the decision is **change**, every active/paused ticket is reclassified
  against the new direction in the same pass, and the new direction block
  above replaces the old one.

| Review date | Decision | Evidence |
|---|---|---|
| 2026-07-06 | declare `reliability-first` | 5-parcel QA compile bounce (2026-07-06); open BUG tickets: BL-107, BL-125, BL-126, BL-127, BL-135, BL-136, BL-137 |
| 2026-07-13 | **retire `reliability-first` (target met); declare NONE pending the human; add `human-requested` class; reclass BL-322** | Triggered by an explicit operator request (the human asked for BL-322 TWICE) and by the scheduled weekly review falling due. All 10 tickets of the declared prioritized slice are closed (BL-107/115/116/125/126/127/131/135/136/137) — declared open-bug count 7 → 0. At review time `active/` + `paused/` held ZERO `aligned` and ZERO `expedite` candidates: every remaining ticket (BL-324, BL-101, BL-322) was `non-aligned`, so the one-slot non-aligned lane (held by BL-324) made BL-322 structurally unpullable. The direction had nothing left to prefer and was purely blocking. |
| 2026-08-01 | **define `queue-jump` (in use since 2026-07-31, never defined); escalate the JumpQ batch's starvation to the human — NOT resolvable in this file** | Triggered by the human asking for the JumpQ pilot-process batch a SECOND time (2026-07-31 morning, then 2026-08-01 morning), which this file's own rule classifies as a defect here. Findings below. |

### 2026-08-01 review — why the JumpQ batch is not moving

The coordinator is not obviously at fault, and neither is the human. Three
facts compose into starvation:

1. **The batch is low/medium severity.** The BL-723 pilot-process tickets are
   `type: defect` with `severity: low` or `medium` (sampled: BL-735 `low`),
   and BL-758 is `medium`. Under Article 3.2.4 they are **not** expedited.
2. **Fifteen `severity: high` defects already sit in `paused/` reading
   `human_approval: approved`** — BL-536, BL-582, BL-586, BL-611, BL-622,
   BL-631, BL-632, BL-638, BL-640, BL-650, BL-663, BL-670, BL-685, BL-761 and
   GH-26 (four more high-severity tickets carry no approval field at all).
   Every one of them outranks the whole JumpQ batch constitutionally.
3. **The pack runs one ticket at a time.** `active_backlog_max_depth` is `1` —
   the mono-router pack's own configured cap, not an Article 3.5 health
   throttle. Verify with `effective_backlog_depth_cli.bb`, never by grepping
   the conf.

At one slot, with fifteen approved high-severity defects queued ahead by
constitutional rule, the batch the human asked for twice is unreachable for as
long as that queue takes to drain — and high-severity defects keep arriving
(BL-771, BL-720 and BL-760 each took the slot legitimately since BL-764
closed). This is starvation by construction, not by a coordinator picking
wrongly on any single promotion.

**A separate, compounding defect:** `promote_and_route_next.sh` does not
enforce the ordering gates at all — BL-680, a `type: feature`, was promoted
over eight eligible high-severity defects on 2026-08-01. That is tracked as
**BL-663** (itself one of the fifteen). So today's promotions are not even
reliably following tier 1; the JumpQ batch loses to whatever the script picks.

**What STEERING can and cannot do.** It can rank `queue-jump` above ordinary
paused work — done above. It **cannot** rank it above an Article 3.2.4
expedited defect: the constitution is superior to this file, and laundering the
batch upward by inflating its `severity:` is explicitly forbidden by the
`human-requested` rule ("Do not launder a human request through `expedite`;
tag it for what it is"). So the specifier will not silently reorder it.

**This needs a human decision.** Four honest options, none of which the
specifier should pick unilaterally:

- **(a) Accept the queue.** The fifteen approved high-severity defects drain
  first. At one slot this is likely weeks, and the pilot close gates the batch
  exists to harden stay open that whole time.
- **(b) Raise the cap.** `active_backlog_max_depth` > 1 lets a `queue-jump`
  slot run beside the expedite lane where scope is orthogonal. Costs
  concurrency risk on a pack designed to be serial; the cap is pack config, so
  this is an operator decision, not a backlog one.
- **(c) Amend Article 3.2.4** so an explicitly human-named batch ranks
  alongside expedited defects. The clean fix if the human wants their own
  requests to genuinely outrank routine severity triage; it is a constitution
  amendment (Article 5), routed through the specifier.
- **(d) Re-triage the batch honestly.** If some pilot-process tickets really
  are high severity — a close gate that lets bad work land is arguably a
  high-severity defect — raise those specific ones on their merits, with a
  written rationale each. This is legitimate; blanket-raising all twenty is not.

Queued as the specifier's next `role_ask` the moment the slot frees (currently
held by the unresolved "use staging please" question from 2026-08-01 05:53).
This escalation takes the slot ahead of `GH-29`, which was previously first in
line, because the human has asked for it twice.

**Until the human answers, the coordinator's instruction is unchanged and
narrow:** promote by the Full rank order above. Concretely — when a slot opens
and no orthogonal Article 3.2.4 expedited defect is eligible, the slot goes to
the JumpQ batch (priority-0 pilot-process tickets first, then BL-758), ahead of
any ordinary paused or Bubble/adopt work. That is the most of the human's
directive that can be honored without a constitutional change.

## Next pulls (as of the 2026-07-13 review)

All ten tickets of the previous prioritized slice are CLOSED; that list is
retired. With no direction in force, pull on the ordinary rules (bugs/expedite
and `human-requested` first, then by priority; orthogonality and the WIP cap
still apply at promotion time):

**Pull these two NOW, in parallel — they are genuinely orthogonal** (verified by
file scope, 2026-07-13):

1. **BL-328** — `expedite`, pri 0. Merged code never reaches the running daemons;
   it DEFEATS QA (a fix can be built, approved, merged, closed and still inert).
   Touches build/health/supervisor-restart — disjoint from everything below.
2. **BL-322** — `human-requested`, asked for TWICE. Touches `swarmEventStream.ts`
   (the `TaskStarted` payload) and the topic render.

**Then the topic-serialisation chain, STRICTLY IN ORDER.** It is serial BY DESIGN,
not by scheduling failure — do not try to parallelise it:

3. BL-329 — serialise topic content into the repo. Overlaps BL-322 on the bot's
   message path, so it follows BL-322 rather than running beside it.
4. BL-330 — state-based reconciliation. Overlaps BL-322 on `swarmEventStream.ts`
   (BL-322 edits `diffTaskStarted`, BL-330 edits `diffTaskCompleted`), so it waits
   for BL-322 to clear that file.
5. BL-331 — delete only after a VERIFIED record. HARD-gated on BL-329 + BL-330:
   building it early destroys un-serialised transcripts, including the human's own
   messages. `depends_on` here is a data-loss gate, not a preference.
6. BL-332 — recreate by replaying the record. Gated on BL-329 + BL-331. The round
   trip it proves is the acceptance test of the whole chain; until it passes,
   "deletion is safe" is a claim rather than a fact.

Also in flight:

- BL-324 — amended three times off review findings (TOCTOU park race, warm core,
  lookahead), and it KILLS PANES. It must not land until QA has driven a real
  park/unpark cycle against a live swarm, per its own e2e procedure.
- BL-101 — headless secondary swarms. Holds until the human names the next
  direction; it is the largest of the cost-themed candidates and should not be
  pulled on inertia.

---

## 2026-07-13 — the INTAKE drain (BL-333..BL-344)

Nine operator INTAKE docs were drained into twelve tickets. Most originate from
the human's own Telegram messages, which went **unread for two days**. Read the
starvation pair first; everything else in this batch is downstream of it.

**Pull these first — the front desk is deaf while they are open.**

1. **BL-333** — `expedite`, pri 2. Alarm when the front desk is starved. Ships
   REGARDLESS of any other decision; it is what converts a silent, indefinite
   failure into a visible one. Small.
2. **BL-334** — `expedite`, pri 3. The restricted front-desk Operator — **the
   human's own chosen fix**, picked from three options he was explicitly asked
   to decide between. `depends_on: [BL-333]`: both change `operator_runtime.bb`'s
   tick and its status output, and this project has been bitten by two roles
   editing one file at once. Serial, deliberately.

An interactive Operator holds the single-Operator slot **permanently** — it is
instructed never to exit — so no disposable Operator is ever spawned to read
Telegram. This is not a discipline lapse to be reminded away; it is structural.
Until BL-334 lands, ANY message the human sends may sit unread indefinitely,
including the ones that created this batch.

**Then the verification pair — "done" does not currently mean "he can see it".**

3. **BL-335** — pri 3. Three features shipped, closed, and STILL INVISIBLE to
   him. Verify against his REAL email and the REAL deployed PWA. A passing test
   is what all three already had; evidence from a test is a bounce.
4. **BL-336** — pri 4. The one-pass headless audit he prefixed **"Action this:"**.
   Its verdict must come from a real headless run, not a code reading — reasoning
   from code is the exact mistake that created this bug class.

**Then, independent — pull as capacity allows (no ordering constraint):**

- BL-340 (pri 4) role benchmarking slice 1 — his own hand-written spec, sliced.
- BL-341 (pri 5) epics as data + epic topics.
- BL-343 (pri 5) does dynamic routing actually save money? A **negative answer is
  a valid, valuable result** — four slices have already shipped on the assumption.
- BL-337 / BL-338 (pri 6) rule-violation observable; cost per ticket.
- BL-344 (pri 6) onboarding negotiation loop.
- BL-339 / BL-342 (pri 7) recert notify+deep-link; topic icons.

**A note on BL-343 and BL-344.** Both were remaining slices that existed ONLY as
prose inside tickets already marked `done`. Both epics therefore READ AS COMPLETE
while their key slice was missing. That is not a bookkeeping slip — it is the
blindness BL-341 exists to remove, and it is why BL-341 must state remaining
slices that have **no ticket yet**. An epic view that can only see tickets cannot
see the omission, which is the one thing it is needed for.

**Decisions the human made, not the swarm (do not re-litigate):**

- Front-desk starvation → restricted 2nd Operator + alarm. Options "interactive
  Operator drains the queue" and "alarm only" were offered and REJECTED.
- Recert via Telegram → notify + deep-link. Verdicts stay in the PWA. In-thread
  verdicts and "both" were offered and REJECTED. Do not build a verdict grammar.

**Still open: the direction itself.** No direction is in force. The two live
candidates remain cost-control and human-in-the-loop/front-desk-trust — and this
batch is heavy with the latter, because the human kept asking and nobody heard.
BL-101 still holds pending that choice.
