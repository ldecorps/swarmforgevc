# Raw intake — Bubble swipe screen: send notes to swarm agents

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket.

Related
- `backlog/GH-29-bubble-screen.yaml` — original four-word ask ("Send note to
  Drop-down Agents / Amend note / Remove note"). Specifier marked NOT drained
  2026-07-31 for lack of detail; this intake is the drained conversation that
  fills that gap. Prefer enriching or promoting GH-29 over minting a twin.
- BL-707 — Android floating overlay companion; expanded panel today is a
  single Let's Talk surface.
- BL-425 / Telegram role steering — existing `type: note` path into a role
  mailbox (often `priority: 00`); bubble should reuse that mailbox contract,
  not invent a parallel channel.
- Other bubble-screen intakes (host-agent thinking live, migrate live screen)
  — complementary swipe pages later; this intake is notes only.

## Goal

When the human expands the Bubble, they still land on Let's Talk. From there,
a horizontal swipe reveals a second page: compose and manage short mailbox
notes to any declared swarm agent.

## Problem

- Expanded Bubble today shows only the Let's Talk green panel.
- Sending a steering note to a swarm role still means Telegram or the laptop.
- GH-29 captured the verb (send / amend / remove) but not navigation, default
  page, agent set, priority, or layout — specifier correctly refused to guess.

## Why this matters

- Bubble is the always-on phone surface; steering agents should not require
  leaving it for Telegram.
- Notes already work in the mailbox; the missing piece is a phone UI that
  composes them.
- Sleeping agents still need human notes; waiting for "active only" would
  defeat the point.

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Navigation.** Expanded Bubble becomes a small horizontal pager. Page one
   is Let's Talk. Page two is Send notes. Swipe left or right between them.
2. **Default.** Welcome / default page stays Let's Talk. Never open on notes
   by default (for now).
3. **Agent set.** Drop-down lists every declared swarm role, whether or not
   that role is currently active / awake. Notes to sleeping agents are fine;
   they pick up when they wake.
4. **Priority.** Bubble-sent notes use priority `00` (same band as Telegram
   human steering), so they outrank ordinary pipeline handoffs (~`50`).
   Priority decides order, not parcel type alone. Already-claimed
   `in_process` work still finishes first; a note is next-look guidance, not
   a hard mid-turn interrupt.
5. **Layout (sparse).** Agent picker at top. Short text box. One big Send.
   Under that: pending list with Amend and Remove. After Send: clear the box,
   keep the same agent selected, brief confirmation (e.g. sent to that role).
6. **Pending scope.** Amend / Remove apply only to notes still waiting
   (queued / unclaimed), not ones already claimed.
7. **Page dots.** Small pager dots so talk vs notes is obvious.
8. **Out for v1.** No "send to all roles" in version one.
9. **Note length.** Keep notes short, in the spirit of today's mailbox note
   message limit — long essays fight the overlay and the agents.

## Requested outcome

1. Horizontal swipe between Let's Talk and a Notes page on the expanded Bubble.
2. Notes page: pick any declared role → write short note → Send at priority
   `00` into that role's mailbox via the existing note handoff path.
3. List pending (unclaimed) bubble-originated or visible notes with Amend and
   Remove.
4. Default expand lands on Let's Talk; pager indicators present.
5. How-to / companion docs updated when shipped.

## Acceptance shape to refine

1) Expand Bubble → Let's Talk is the first page.
2) Swipe → Notes page appears; swipe back → Let's Talk.
3) Every declared role appears in the picker even when dormant.
4) Send deposits a `type: note` with priority `00` for that role.
5) Amend edits a still-pending note; Remove drops it; claimed notes are not
   amendable/removable from this UI (or clearly disabled).
6) After Send, text clears, role stays selected, confirmation shown.

## Out of scope

- Host-agent thinking live screen / migrate Live Screen (separate intakes).
- All-roles broadcast send.
- Hard interrupt of an agent mid-turn (use barge-in / other intakes).
- Changing Telegram steering behavior.
- Minting without specifier disposition — human asked specifier to weigh in.

## Suggested type / priority hint for mint

- type: feature (Bubble UX + existing note handoff reuse)
- mutation_cost: medium (Android pager + bridge/API to enqueue note + pending
  list amend/remove + how-to)
- Ties to GH-29; Android acceptance-seam caution from other bubble intakes
  still applies (BL-761 class) — specifier should sequence accordingly.
- Not offline expeditor unless the human asks.

## Specifier: please weigh in

Open questions the human did not lock (safe for you to propose or ask):
- Exact pending-list source of truth (only notes this UI sent vs all pending
  notes for that role).
- Whether amend rewrites the parcel in place or replaces it.
- Bridge vs local enqueue path from the companion.
- Naming of the page ("Notes" vs "Steer" vs other).
- Whether GH-29 is promoted in place or closed in favor of a BL ticket.
