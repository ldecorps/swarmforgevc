# Raw intake — Bubble Pipeline board (in-flight grid + short blurbs + detail popup)

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket. Human said this is the **last** Bubble screen in this
batch of intakes.

Related
- BL-452 / BL-464 / BL-467 — standing Telegram Pipeline Board (agents ×
  in-flight tickets grid, coordinator-fed active rows, pin). Bridge also
  serves `/pipeline-board` Mini App-style UI. Bubble should reuse the same
  read model, not invent a second board.
- Sibling Bubble pager intakes from the same evening:
  Notes, Control, Live (coordinator+resident), clarification blink.
- Mini App ports (Live, Pipeline board, and any other surface we port):
  **once the functionality lands on Bubble, Mini App copy may be removed.**
  Human explicitly said cutover / removal can be **dealt with later** — do
  not block version-one Bubble ship on Mini App deletion. Dual-run OK until
  a later deprecation slice.

## Goal

A Bubble screen that shows the in-flight pipeline board: agents as rows,
tickets as columns, mark where each ticket sits. On the main screen, short
descriptions for those in-flight tickets so the human need not open details
to know what each is about. Tap a ticket → popup with fuller detail (spec /
ticket body / Gherkins).

## Problem

- Pipeline board today is Telegram / Mini App; Bubble is the phone home
  surface and lacks this glanceable grid.
- Ticket ids alone are not enough on a small screen; short blurbs on the
  main view matter.
- Detail (YAML/spec, Gherkins) should be one tap away, not a laptop dig.

## Why this matters

- Answers “what is in flight and with whom?” at a glance.
- Short descriptions reduce tap fatigue.
- Detail popup supports real judgment without leaving Bubble.

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Navigation.** Pipeline board is another expanded-Bubble pager page
   (same family as Talk / Notes / Control / Live).
2. **Grid.** Agents as **rows** (lines). In-flight tickets as **columns**.
   Mark at the cell where that ticket currently sits (which agent). Roughly
   today’s board semantics.
3. **Main screen blurbs.** Below (or with) the grid, still on the main
   Pipeline view: a **short description** for each in-flight ticket shown.
   Human must not need the popup to know what the ticket is about.
4. **Detail popup.** Tap a ticket (cell or blurb) → popup / sheet with
   fuller detail: ticket spec / body (YAML-ish substance), and Gherkins /
   acceptance features as available. “Hyperlink” in the human’s words =
   tappable ticket → detail, not a raw URL dump.
5. **Mini App retirement (ports policy, this batch).** For surfaces we port
   to Bubble (including Pipeline and Live): **remove from Mini App once
   Bubble has the functionality.** Sequencing of that removal is **later** —
   not a gate on landing Bubble. Specifier may note a follow-up deprecation
   slice; do not over-scope v1.
6. **Out of version one.** Redesigning the whole backlog dashboard; editing
   tickets in place; replacing Telegram board pin on day one.

## Requested outcome

1. Bubble Pipeline page rendering the in-flight agent × ticket grid from the
   existing board read model.
2. Short description list (or captions) for those tickets on the same main
   screen.
3. Tap → detail sheet with spec/body + Gherkins when present.
4. Honest empty state when nothing is in flight.
5. How-to line when shipped; Mini App removal tracked separately later.

## Acceptance shape to refine

1) Open Pipeline on Bubble → see agent rows and in-flight ticket columns with
   correct marks vs live swarm state (same source as today’s board).
2) Each in-flight ticket has a short description visible without opening
   detail.
3) Tap ticket → detail shows spec/body and Gherkin/feature text when those
   artifacts exist for the ticket.
4) No in-flight work → clear empty state, not a stale grid.
5) Completing watch of in-flight work does not require Mini App Pipeline
   (Bubble sufficient). Mini App may still exist until a later cutover.

## Out of scope

- Immediate Mini App deletion (later).
- Control / Notes / Live / clarification blink (separate intakes).
- Minting without specifier disposition.

## Suggested type / priority hint for mint

- type: feature (Bubble UX + existing pipeline-board read model + detail
  fetch for spec/Gherkin)
- mutation_cost: medium (Android grid + blurb list + detail sheet + bridge
  reuse; Android acceptance-seam / BL-761 sequencing applies)
- Pair or sequence with Live Mini App port on deprecation later.
- Not offline expeditor unless the human asks.

## Specifier: please weigh in

Open questions the human did not fully lock:
- Pager order among Talk / Notes / Control / Live / Pipeline.
- Blurb source: first paragraph of `notes:`, title only, or a dedicated
  summary field.
- Detail sheet: native render of YAML vs prettified markdown; how to load
  linked `.feature` files.
- Mono-router vs full classic column set on Bubble’s small width (horizontal
  scroll OK?).
- Whether Telegram board stays forever as mirror or eventually Bubble-only
  for phone (human: Mini App removal later; Telegram pin not decided).

---

## Specifier disposition 2026-08-02 — NOT drained, same blocker as the sibling intakes

Read and assessed. Held for the same reason the four sibling Bubble intakes
were held on 2026-07-31, re-verified today: this repository still has no
settled policy for where Android device behaviour's acceptance contract lives.
Speccing this today would mean writing one more inert feature file — every
scenario failing "no step handler matched" — which is exactly the defect
BL-761 and BL-769 exist to stop.

Re-checked 2026-08-02, and one thing HAS changed: a JVM unit seam now exists
in the tree, hand-built by the Bubble pairing hotfix (`junit` in
`android/app/build.gradle.kts`, plus `PairingSaveTest.kt`). So "can a JVM test
run here at all" is now answered YES by demonstration. That does **not**
unblock this intake, because the missing piece was never the mechanism — it is
the POLICY naming the Android device surface as environmentally unsuitable and
stating where Bubble behaviour is verified instead. BL-769 has been amended to
narrow onto exactly that, and remains the keystone.

Resume point: once BL-769 lands its policy, spec this against it.

**Split hint for whoever drains this.** The blocker covers Android *device*
behaviour only. If this intake contains a slice that lives on the bridge, the
extension host, or `.swarmforge/` state — data, endpoints, or projections the
phone merely renders — that slice is testable in the Node runner today and is
NOT blocked. Split it out and spec it rather than holding the whole intake
behind BL-769.

---

## Specifier disposition 2026-08-06 — BL-769 blocker CLEARED; held on one cross-epic contradiction

The BL-769 blocker every prior disposition on this file names is GONE. BL-769
and BL-761 are in `backlog/done/M8/`, the Android testability policy is in the
constitution, and the gradle JVM seam runs. This intake is no longer blocked on
where an Android acceptance contract can live.

It is held on something new, found by reading the four screen intakes as one
cluster (BL-680 consolidation pass) instead of one at a time.

**The contradiction.** Two epics give opposite answers to how a Bubble screen
is built:

- **BL-774** (Bubble Live Screen epic, 2026-08-01) — "*Native UI only, or a
  staged WebView-backed migration?* — **Native**, from slice A. A WebView would
  carry the webview constraints this migration exists to escape." Its slice A,
  BL-775, is specced native and is already `human_approval: approved`.
- **BL-824** (Bubble thin shell + remote UI, 2026-08-06, human-approved) —
  the human's own locked decision of 2026-07-31: auto-update for most of the
  app, a thin native shell, and **APK only when the shell itself changes**.
  A new native screen changes the APK, which that decision forbids.

BL-774's "native" was a specifier default, explicitly labelled as such under
"the defaults taken". BL-824's is a human ruling. That asymmetry suggests the
answer, but reversing the technology of an already-approved ticket (BL-775) is
the human's call, not a specifier's — so it was asked rather than assumed.

**Asked of the human 2026-08-06** via `role_ask.bb`, with three options: remote
HTML for all screens (respec BL-775, screens sequence behind BL-825); native for
all screens (thin shell stops short of screens); or BL-775 stays native and only
new screens are remote.

**Why the whole cluster waits on it.** The answer decides each screen's
technology, its testability story (a bridge-served HTML bundle is Node-testable
today; a native page needs the JVM seam and a manual device procedure), its
`depends_on` (BL-825 or nothing), and whether these are slices of BL-774 /
BL-824 or their own epic. Speccing four screens before it lands would mean
rewriting four tickets afterwards.

**Nothing else on this intake is unclear.** Its human-locked decisions are sound
and are carried forward verbatim at mint. The remaining open questions the human
listed (page titles, pager order, window defaults, blurb source, chart-vs-number
layout) are specifier calls and will be decided at mint, not re-asked.
