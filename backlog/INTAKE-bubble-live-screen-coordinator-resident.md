# Raw intake — Bubble Live screen: coordinator + resident panes (port + steer)

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket.

Related
- `backlog/INTAKE-migrate-live-screen-from-mini-app-to-bubble.md` — earlier
  migrate-Live-to-Bubble capture (parity + cutover). Specifier left it
  undrained 2026-07-30 pending a batch disposition question. This intake is
  the drained 2026-07-31 conversation that fills UX detail (who, refresh,
  metadata, steer). Prefer one ticket / epic that satisfies both rather than
  minting twins.
- `backlog/INTAKE-bubble-host-agent-thinking-live-screen.md` — **different**
  surface: host Cursor / Let's Talk agent cognition. This intake is swarm
  coordinator + resident tmux panes (today's Mini App Live Screen).
- `backlog/INTAKE-bubble-send-notes-swipe-screen.md` /
  `backlog/INTAKE-bubble-control-shifts-holiday.md` — sibling Bubble pager
  pages; Live is another swipe page in the same family.
- BL-521 / BL-522 — Resident Spy / Swarm Live Screen Mini App; polls
  `/resident-pane` with tmux `capture-pane` snapshots.
- BL-707 — Android floating overlay companion.

## Goal

Port the Mini App Live Screen into Bubble, improved. Overview shows
**coordinator** and **resident**. Tap either for full screen. Keep today's
poll cadence. Show ticket / title / role / model / claim age as today. Add
a text box on full screen to steer that agent as if typing into the tmux
pane.

## Problem

- Live Screen still depends on the Telegram Mini App webview.
- Bubble is the phone home surface but cannot yet watch coordinator and
  resident panes natively.
- Human wants ticket and model visibility without leaving Bubble, and the
  ability to steer from the pane itself (not only Notes / Telegram).

## Why this matters

- Watching panes is how the human stays present with the swarm on the road.
- Ticket id + title + model answer "what are they doing and on what brain?"
- Steer-in-pane closes the loop: see → type → agent receives, without a
  laptop tmux attach.

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Navigation.** Live is another expanded-Bubble page (same pager family as
   Notes / Control). Default expand still Let's Talk unless later changed.
2. **Cast.** Overview shows **coordinator** and **resident** (mono-router
   shape). Tap either → full-screen pane view.
3. **Refresh.** Keep the **current** Mini App poll period — measured as
   **1500 ms** pane refresh in `residentSpyUiHtml` (`setInterval(refresh, 1500)`).
   Do not invent a true continuous stream in version one. Near-live via the
   same snapshot poll is enough unless that later feels laggy.
4. **Metadata (as Live shows today).** For the resident (and coordinator when
   applicable): ticket id, ticket title, role label, model label, claim-entered
   age. Visible in overview and full screen.
5. **Steer.** On full-screen pane: a text input (+ deliberate send) that
   steers that agent as if the human typed into the tmux pane. New versus
   today's Mini App. Specifier should pick confirm-before-send vs single
   deliberate send; human wants the capability locked in.
6. **Suggestions the human accepted in spirit (include unless challenged).**
   Clear idle / sleeping empty state. Stale mark if the tunnel lags. Do **not**
   pack approvals or Control verbs onto this page.
7. **Out of version one.** True continuous tmux stream / websocket pipe.
   Host-agent thinking screen (separate intake). Full classic eight-pane grid
   unless mono later expands.

## Requested outcome

1. Bubble Live page with coordinator + resident cards/panes.
2. Tap → full screen for that pane; same 1.5s snapshot refresh.
3. Ticket id, title, role, model, claim age on the strip (parity with Mini App
   live strip, improved layout OK).
4. Full-screen steer text box → inject into that role's pane (tmux send-keys
   or equivalent existing inject path if one exists).
5. Idle / stale states honest; no fake "live" when capture fails.
6. Mini App Live: once Bubble Live lands, Mini App Live may be removed.
   Human said cutover can wait — dual-run OK; do not block Bubble v1 on
   Mini App deletion (same ports policy as Pipeline board intake).

## Acceptance shape to refine

1) Open Live from Bubble → see coordinator and resident.
2) Tap resident → full screen; pane text updates on ~1.5s cadence when bridge
   healthy.
3) When resident has a claim: ticket id + title + role + model + claim age
   visible.
4) Type steer text, send → text reaches that agent's pane / session.
5) Quiet / missing pane shows idle, not a spinner forever.
6) Operator can complete watch + light steer without opening Mini App Live.

## Out of scope

- Control page verbs (start/stop/holiday/shifts) — separate intake.
- Notes mailbox compose — separate intake.
- Host Cursor agent thinking stream — separate intake.
- True byte-stream of tmux in v1.
- Minting without specifier disposition.

## Suggested type / priority hint for mint

- type: feature (Bubble UX + existing `/resident-pane` read model + new steer
  write path)
- mutation_cost: medium–high (Android Live UI + bridge reuse + pane inject +
  how-to; Android acceptance-seam / BL-761 sequencing applies)
- Fold with or supersede detail of
  `INTAKE-migrate-live-screen-from-mini-app-to-bubble.md` when minting.
- Not offline expeditor unless the human asks.

## Specifier: please weigh in

Open questions the human did not fully lock:
- Pager order among Talk / Notes / Control / Live.
- Steer: confirm dialog vs single Send; whether steer uses raw tmux keys,
  mailbox `note`, or `/btw`-style non-disruptive inject.
- Native Android UI vs WebView shell of existing Mini App HTML for slice A.
- Mini App retirement timeline (from migrate intake).
- Whether coordinator always has a ticket strip or only when holding work.
