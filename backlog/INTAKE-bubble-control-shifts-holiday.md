# Raw intake — Bubble swipe screen: swarm Control (start / stop / shifts / holiday)

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket. Picture mock emailed to notify_email_to the same evening
for phone review. Persisted for specifier/coder:
`docs/design/bubble-control-screen-mock.png` (copied into repo 2026-08-01).

Related
- `backlog/INTAKE-bubble-send-notes-swipe-screen.md` — sibling Bubble pager
  page (Notes). Same expanded-Bubble horizontal pager family; this intake is
  the Control page.
- BL-707 — Android floating overlay companion; expanded panel today is a
  single Let's Talk surface.
- BL-423 / Telegram Control topic — existing stop (drain & emergency),
  restart, pause with confirm. Bubble should drive the same class of verbs,
  not invent a second control plane.
- BL-698 / operator policy — shift and holiday overlay (who is on, quiet
  days); when schedule packs land, both should read the same shift names.
- BL-762 — finish-shift / bedtime leave bubble reachable — complementary;
  Control must not strand the phone path.

## Goal

When the human expands the Bubble, they still land on Let's Talk. Horizontal
swipe reaches a Control page where they can drive the swarm: start, drain
stop, emergency stop, holiday quiet, and day / evening / night shift.

## Problem

- Swarm drive today is mostly Telegram Control / laptop.
- Bubble is the always-on phone surface but cannot yet start, stop, drain,
  holiday, or pick a shift.
- Human wants one phone page for that, not only chat verbs.

## Why this matters

- Away from desk, the human still needs to put the swarm on holiday, wake it,
  or change shift without hunting Telegram topics.
- Dangerous verbs need the same confirm discipline as Telegram so a pocket
  tap does not kill the swarm.
- Pairs with the Notes swipe page: Talk / Notes / Control as pager pages.

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Navigation.** Same expanded-Bubble horizontal pager as Notes. Default /
   welcome page stays Let's Talk. Control is another swipe page (order vs
   Notes is open — see open questions).
2. **Version-one verbs.**
   - Start swarm
   - Drain and stop
   - Emergency stop (confirm tap required)
   - Holiday on / off (wake)
   - Shift pick: Day, Evening, Night — one active shift at a time
3. **Out of version one.** Pause timers, bounce individual services, model
   switches, and other fiddly controls.
4. **Confirm.** Anything that tears the swarm down needs a confirm tap,
   same spirit as Telegram Control.
5. **Holiday vs shifts (UX).** Holiday is the quiet switch. Day / Evening /
   Night stay as which shift is staffed when not on holiday. Holiday on
   greys or ignores the shift picks until holiday is off. Do not treat
   "untick all shifts" as a second quiet control in v1 — that felt
   redundant to the human once they saw the mock.
6. **Mock.** Human reviewed a picture mock (emailed); layout direction:
   status line, Start / Drain & stop / Emergency stop, Holiday switch,
   then Day / Evening / Night segmented picks, pager dots.

## Requested outcome

1. Control page on the expanded Bubble pager.
2. Version-one verbs above, wired to the real swarm control / operator-policy
   paths (reuse Telegram Control semantics where they already exist).
3. Holiday quiet and shift pick reflected in visible status (e.g. Swarm
   running · Day shift, or Holiday quiet).
4. Confirm before emergency stop (and drain stop if specifier keeps Telegram
   parity).
5. How-to / companion docs updated when shipped.

## Acceptance shape to refine

1) Expand Bubble → Let's Talk first; swipe reaches Control.
2) Start / Drain & stop / Emergency stop / Holiday / Day·Evening·Night are
   present and actionable when the host bridge can reach the swarm.
3) Emergency stop does nothing until confirm.
4) Holiday on → swarm quiet policy; shift picks disabled or ignored until
   holiday off.
5) Exactly one of Day / Evening / Night selected when not on holiday.
6) Status line matches the live policy after each successful action.

## Out of scope

- Notes page (separate intake).
- Host-agent thinking live / migrate Live Screen.
- Pause-duration menus, per-service bounce, model switch.
- Minting without specifier disposition.

## Suggested type / priority hint for mint

- type: feature (Bubble UX + existing control / policy reuse)
- mutation_cost: medium–high (Android pager page + bridge APIs for control
  verbs + holiday/shift policy write + confirms + how-to)
- Android acceptance-seam caution (BL-761 class) still applies — sequence
  with other Bubble intakes.
- Not offline expeditor unless the human asks.

## Specifier: please weigh in

Open questions the human did not lock:
- Page order: Talk → Notes → Control, or Talk → Control → Notes.
- Whether Drain & stop also requires confirm (Telegram does for stop modes).
- Exact bridge vs front-desk vs cursor-operator command path from companion.
- Whether Start is disabled when already running (mock showed it muted).
- Naming ("Control" vs "Shift" vs "Swarm").
- Whether this folds with any existing GH / BL control ticket or stays new.
