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

## Standing human preference (2026-08-31) — exhaust `hold/` before `paused/`

**Human directive (Cursor session, 2026-08-31):** when an active slot opens,
promote the next ticket from `backlog/hold/` rather than from `backlog/paused/`.
Exhaust the held pool first.

**Effect (pull order, Article 3.1 release):**

- While any **approved** ticket remains in `backlog/hold/`, do **not** promote
  from `backlog/paused/` into `active/`.
- On each open slot, human-release (hold → active) the top approved held ticket
  by ordinary priority ordering among hold/, then route. Leave the rest in
  `hold/` until the next slot — do not dump them into `paused/` where Article
  3.2.4 expedite ranking would lose them to unrelated high-severity paused work.
- `human_approval: pending` held tickets (e.g. BL-1300) stay held until the
  human rules; they do not block release of other approved hold/ tickets.
- Auto-pick (`promote_and_route_next.sh`) still never reads `hold/` — this
  preference is a coordinator/human release order, not a gate change.

**Scope boundary — it governs which pool an OPENING slot pulls from, and
nothing else (specifier, 2026-08-31).** The directive is a pull-order
preference. It does not authorise creating an open slot by demoting a ticket
that is already active, and it says nothing about demotion at all.

- **Never demote a ticket whose parcel is already in flight.** Moving the YAML
  does not stop, pause, or recall a parcel — no role reads the backlog pool to
  decide whether to keep working. The demote removes the work from the
  accounting while it keeps moving, so the cap is not relieved; it is breached
  silently, and the coordinator then promotes on top of hidden WIP.
- Before demoting anything, check whether a parcel exists for it: sweep every
  role inbox (`new` and `in_process`, master **and** worktree) for the task
  name, and check `git log --all --grep=<id>` for a commit newer than the
  promotion. An empty `assigned_to:` proves nothing — that field records where
  the coordinator routed, and goes stale the moment the parcel moves on.
- A ticket with a live parcel belongs in `active/` for as long as that parcel
  is in the pipeline, whatever its priority. Article 3.1 defines `active/` as
  "Items currently in the pipeline"; a parcel sitting at the architect or at QA
  *is* in the pipeline. Leaving its ticket in `paused/` also breaks post-QA
  bookkeeping, which closes `active/` → `done/` and would find nothing to move.
- When the held pool genuinely should be drained first and every slot is busy,
  the correct response is to **wait for a slot to open**, not to manufacture
  one. Held work keeps; a half-built parcel does not.

**Incident this came from (2026-08-31 00:45):** BL-1307 and BL-1308 were
demoted `active/` → `paused/` to free two slots for `hold/`. BL-1308's coder
was mid-work and committed seven minutes later; the parcel is now at the
architect. BL-1307's parcel was already complete and parked at QA. Neither
demote stopped anything: real WIP went from 2 to 4 while the recorded count
stayed at 2. Both tickets now carry their pipeline state in their own
`notes:` so this reading cannot recur.

## Standing human preference (2026-08-25 evening) — finish local Ollama / Qwen epic

**Human directive (Cursor session, 2026-08-25 ~19:31 BST):** prioritize the
**remaining** BL-1125 (`local-llm-swarm`) slices now that BL-1126, BL-1127,
and BL-1140 are done.

**Effect (pull order, not a Direction-lane theme):**

- Minted children of the remaining slices land as `direction: queue-jump`
  with JumpQ-tier priority and `human_approval: approved` — see
  `backlog/INTAKE-prioritize-local-ollama-remaining-20260825.md`.
- Pull those ahead of ordinary paused work and ahead of pipeline-note
  actives when a slot opens (or free a slot for them). Do not starve
  behind Bubble / pipeline-note inertia.
- Cold-swap day-shift to `ollama-qwen3-mono-router` is **explicitly
  authorized** once the cold-swap child is specified; do not thrash to
  `qwen-forge` without a separate ask.
- Model Steward: keep investing in the local Ollama path; **do not** treat
  `human-operator-priority:ollama-local-qwen-20260825` as an authoritative
  outrank (revoked by BL-1140 — battery/scorecard evidence wins).

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

**Human directive 2026-08-28 (Cursor, morning) — day + night, evening
OFF:** Day **09:00–17:00** and night **01:00–09:00** Europe/London.
Evening **17:00–01:00 idle** (bedtime/`finish-shift` at 17:00; night-start
at 01:00). Cooldown window **on** 17:00→01:00. State:
`.swarmforge/operator/continuous-shifts.json` (mode `day-night`) and
crontab `.swarmforge/operator/crontab.day-night`. Note:
`.swarmforge/operator/NOTE-day-night-evening-off-20260828.md`.

**Human directive 2026-08-24 (Cursor) — REVOKED 2026-08-28:** had been
day-only 09:00–17:00; evening and night off.

**Human directive 2026-08-18 (Cursor, evening) — REVOKED 2026-08-24 / again
by 2026-08-28:** had restored full-time 3×8 (night, day, and evening all
on; cooldown off).

**Human directive 2026-08-17 (Cursor, evening) — restored in substance by
2026-08-28:** day + night on, evening off, cooldown 17:00→01:00.

This freeze is stronger than "Awaiting the human" silence: it is an explicit
veto on a class of work, recorded here so specifier/coordinator do not keep
pulling Telegram / PWA-client UX by inertia while Bubble is the stated
ramp.

## Standing human directive (2026-08-30 ~21:35 BST) — raise swarm throughput

Raw intake: `backlog/archive/INTAKE-operator-question-1788122140494.md` (verbatim,
with the specifier's disposition appended). Recorded here rather than minted as a
ticket because its substance is **WIP / pull policy — a coordinator constraint,
not a ticket**, the same disposition as the 2026-08-23 "Cursor seats, then sleep"
directive above. It is also the exact decision the 2026-08-01 review named as
option **(b) Raise the cap** and referred out as "an operator decision, not a
backlog one". The operator has now made it.

The human's own words, verbatim:

> Human directive to the coordinator: augment (increase) the swarm's throughput —
> raise dispatch concurrency / WIP so more tickets progress in parallel.
> Coordinator to decide and apply the throughput increase within safe limits.

### Effect on the pull policy

- **The 2026-08-30 cap-1 hold is superseded.** `swarmforge.conf` reads
  `config active_backlog_max_depth 1` under the comment "Cap held at 1 while
  reverse-hop + AUDIT_REQUIRED verification is in flight (operator 2026-08-30).
  Restore the standing depth after that settles." That hold landed in
  `44d2d42591` at **17:03 BST**; this directive is from **~21:35 BST the same
  day** and is the later operator word. Article 3.5's standing operator
  directive (2026-07-09) — never leave a throttle engaged after recovery —
  points the same way: raise, do not wait to be told twice.
- **The coordinator picks the number.** The human delegated it explicitly
  ("Coordinator to decide ... within safe limits"). Nothing in this file
  mandates a value, and the specifier does not set one.
- **Read the effective depth from the CLI, never by grepping the conf:**
  `bb swarmforge/scripts/effective_backlog_depth_cli.bb <root>` — it read `1`
  when this section was written.
- **A built lever already exists and is switched off.** BL-1128 shipped
  `bb swarmforge/scripts/headroom_cap_raise_cli.bb <root> raise|unhold|undo`,
  which raises the configured depth only when CPU/memory headroom AND the
  Article 3.5 throttle both allow, and can `undo` back to the prior depth. All
  five of its keys are still commented out in `swarmforge.conf`
  (`active_backlog_max_depth_ceiling`, `active_backlog_headroom_raise_step`,
  `active_backlog_headroom_raise_cooldown_minutes`,
  `active_backlog_headroom_cpu_ratio_max`,
  `active_backlog_headroom_mem_available_mb_min`). Enabling them honours this
  directive *continuously and reversibly*, rather than as one manual edit that
  nothing later re-evaluates.

### What "within safe limits" has to weigh — facts, not a recommendation

1. **The verification the cap-1 hold was protecting has not finished.** Since
   17:03 the reverse-hop / AUDIT_REQUIRED work has minted BL-1299…BL-1303, and
   **BL-1299 is `type: defect`, `severity: critical`, `status: todo`, still in
   `paused/`**, with three recorded handoff refusals (newest `f94ebfd60c`).
   Raising the cap does not repeal that — it means concurrent parcels while a
   critical defect in the handoff path is open.
2. **Orthogonality stops being decorative.** At depth 1 the Concurrent Work
   Orthogonality rule is structurally inert. Above 1 it is the only thing
   keeping two actives off the same file — and 2026-08-30 already produced a
   worktree-drift storm across cleaner/architect/hardender/documenter.
3. **One 2026-08-01 blocker is now closed.** BL-663 (`promote_and_route_next.sh`
   not enforcing the ordering gates) is in `backlog/done/M8/`. That was the
   compounding defect which made a higher cap unsafe at the time; it is no
   longer a reason to hold.
4. **Every stage is single-seat.** No pack in `swarmforge/packs/` declares a
   duplicate `window` line for one role. Raising the cap therefore *pipelines*
   the stages — fewer roles idle — but does not widen any single stage.
   BL-1004's `seat_affinity_lib.bb` already handles sibling seats, but none are
   staffed anywhere. If the cap alone does not deliver "more tickets progress in
   parallel", a second seat on the narrowest stage is the next lever, and that
   is a pack change: an operator decision, not a backlog one.

### Expiry

A standing raise, not a one-shot: spent only when the human revokes it or
declares a new WIP policy. An Article 3.5 health throttle may still lower the
cap transiently — and must then be restored to the standing depth, per that
article, not left engaged.

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
  current value each time) remains the absolute WIP ceiling. Read it via
  `bb swarmforge/scripts/effective_backlog_depth_cli.bb <root>`, never by
  grepping the conf. The human's 2026-08-30 throughput directive above asks the
  coordinator to RAISE this ceiling within safe limits and supersedes the
  17:03 cap-1 hold still written in the conf comment — a raise is now the
  standing instruction, not a deviation from this policy.
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

**RETIRED 2026-08-28 — do not raise this escalation.** Two things changed.
The blocking "use staging please" question was answered by the human on
2026-08-27 23:45Z — "stray keystroke, drop it" — so the specifier's `role_ask`
slot is FREE (see
`backlog/answers-archive/ANSWER-2026-08-27-use-staging-please-dropped.md`).
And the escalation this paragraph queued is itself moot: the JumpQ-vs-expedite
starvation it was written to resolve no longer occurs. The slot is not held for
it; `GH-29` is first in line again.

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

## Standing human directive (2026-08-23 ~02:20 BST) — Cursor seats, then sleep

Raw intake: `backlog/archive/INTAKE-cursor-seats-then-sleep.md` (verbatim, with
the specifier's disposition appended). Recorded here because its substance is
**pull order and shift timing** — a coordinator constraint, not a ticket.

The human's own words, verbatim:

> Tomorrow the human wants **Cursor in the coder and QA seats**. Keep the
> swarm working the Cursor seat chain overnight. **Sleep (finish-shift) only
> after that chain has landed** — do not take the Sunday day-shift skip.

> 1. Keep working BL-1078 (active, pri 0) → then promote BL-1079 → BL-1080.
> 2. BL-1081 may proceed in parallel (no depends_on on 1078).
> 3. Do **not** promote local-LLM tickets ahead of this chain.
> 4. Do **not** run day-shift-end / finish-shift early for "Sunday quiet".

> A cron watcher (`.swarmforge/operator/sleep-when-cursor-landed.sh`) will
> `./finish-shift` once all four are in `backlog/done/`. Do not fight that.

> BL-1082 / BL-1052 / BL-1053 (local-LLM) were **parked** — resume after Cursor
> coder/QA seats are usable.

> Human will staff coder + QA with Cursor via the BL-1080 pack. Swarm may stay
> bedtime until the human brings it back.

### Effect on the pull policy while this directive stands

- **Pull order is pinned:** BL-1078 → BL-1079 → BL-1080 (strictly serial —
  BL-1080 declares `depends_on: [BL-1079]`), with BL-1081 available in
  parallel at any time. Nothing outside this chain is promoted ahead of it.
- **The local-LLM cluster is parked, by name:** BL-1082, BL-1052, BL-1053.
  Not cancelled — resumed once the Cursor coder/QA seats are usable.
- **Expedite is not a loophole.** Article 3.2.4 still reorders the queue for a
  `critical`/`high` defect, and this directive does not repeal it. But a defect
  minted at `medium` or below cannot jump this chain, and no ticket should be
  graded up in severity to get around the pin. BL-1090, minted the same night,
  was deliberately kept at `medium` for exactly this reason.
- **Do not finish-shift early.** The cron watcher owns the sleep decision; the
  swarm neither pre-empts it nor fights it.
- **Promotion freeze re-engaged (2026-08-23 ~09:51 BST):** human set
  `.swarmforge/operator/control-pause.json` (`active: true`) again — effective
  depth **0**. In-flight BL-1078 (QA) continues; nothing else promotes.
  **BL-1081 stays paused.** Clear the pause (resume) only after 1078 is in
  `done/` and you want BL-1079 pulled.
- **Expiry:** this directive is spent the moment all four tickets are in
  `backlog/done/` and the watcher has fired. An expired directive is not a
  policy — retire this section then, do not leave it silently vetoing work.
