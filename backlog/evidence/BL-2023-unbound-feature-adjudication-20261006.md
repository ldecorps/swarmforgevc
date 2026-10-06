# BL-2023 - specifier adjudication of the four features the BL-1937 census missed (2026-10-06)

Deprecator pass (Article 3.6) over the four features BL-2023 owns. Each
feature fails on main because most of its steps match no handler. One to
three generic steps bind elsewhere, which is why the 2026-10-03 census
("no step resolves") missed them. Retire, never reword.

## BL-unassigned-active-coordinator-nudge - RETIRED whole (superseded)

No ticket. Added by c7824e6136 ("Nudge coordinator when active tickets
lack assigned_to."), with no handler ever registered.

- The behaviour is live: `chase_sweep_lib.bb`'s
  `read-unassigned-active-items`, `unassigned-active-items` and
  `unassigned-active-draft-lines`, driven by `handoffd.bb` (line 2514).
- Scenario 01 ("an unassigned active item with no handoff trail nudges the
  coordinator") is covered by BL-1093's `nobody-assignee-01` (an active
  ticket whose assigned_to names nobody, no dispatch trail: the coordinator
  is nudged and no handoff is addressed to it by name). BL-1093 is done, and
  its feature is 8/8 on main (measured 2026-10-06).
- Scenario 02 ("an already-nudged unassigned item is not re-nudged", Given
  "a prior coordinator note already trails the item") states a premise
  BL-1804 deliberately reversed. Dedupe is now by a nudge still PENDING
  (new/in_process) in the coordinator's mailbox. A note the coordinator has
  read must not silence the next one (`unassigned-active-nudge-pending?`
  docstring), and a to:-coordinator note is never a dispatch trail.
  BL-1804's `the-nudge-is-not-repeated-while-unread-03` is the corrected
  scenario. BL-1804 is done, and its feature is 5/5 on main (measured
  2026-10-06).
- "no assigned_to is written on the ticket by the sweep": the sweep has no
  write path to `backlog/active/`. It only builds a note draft
  (`unassigned-active-draft-lines`, to: coordinator).

Wiring it would gate a stale premise (scenario 02) and duplicate a green
scenario (01). File removed, recorded in the retirement registry under
`BL-unassigned-active-coordinator-nudge`, and its register row dropped.

## BL-1054 - PARKED as .feature.draft (not retired)

`backlog/debt/BL-1054-...yaml` is `status: todo`, parked unbuilt on
2026-08-24 (87c3ede599). cbf3e77ad9 (2026-10-03) moved its eleven debt
siblings' features to `.feature.draft` (BL-233: an executable feature for
unbuilt work fails every scenario). BL-1054 was not among them because the
census counted only wholly unbound files. The same treatment applies: the
file is renamed to `.feature.draft`, the ticket's `acceptance:` is
repointed with the same unparking line, and the register row is dropped.
Whether the hydrate pack is still wanted is a question for the freshness
gate if the ticket is ever unparked. It is not this pass's to answer, so
nothing is retired.

## BL-703 - RETIRED whole (duplicate)

The feature says "Slice 2 of BL-698", and each of its nine scenarios is the
same behaviour as a BL-698 scenario (BL-703 line -> BL-698 line: 8->14,
14->20, 20->26, 25->134, 34->143, 38->149, 46->157, 54->167, 61->174). The
only differences are "Stop and run" vs "Stop & run" and the Background,
neither of which changes the meaning. They are adjudicated once, below.
File removed, recorded in the retirement registry under BL-703, register row
dropped.

## BL-698 - 9 scenarios WIRED (BL-2025), 17 scenarios and 3 outline rows RETIRED

Liveness evidence was gathered read-only across the bridge modules:

- **The bridge is live.** The launch chain is `swarmforge.sh`, then
  `start_ancillary_services.sh`, then `start_cursor_bridge.sh`, then
  `cursor_bridge_supervisor.bb`, then `telegram-cursor-bridge.js`, then
  `runCursorBridgeApp`. `swarm_ensure.bb` and the `operator_runtime.bb`
  watchdog repair it.
- **The topic name changed.** BL-725 renamed "Cursor Remote" to "Host". As
  BL-541 ruled for BL-702, a Given/When that names the topic still binds.
- **Prior rulings.** BL-541's rulings on the BL-704 copies of #18 and #26
  are followed here.

| # | Scenario | Ruling | Why |
|---|---|---|---|
| 1 | /pilot refuses while the swarm is live | WIRE | Live `handlePilotInboundAction` -> `isSwarmLive`. The Given is a disjunction; the code reads its tmux branch. |
| 2 | Stop & run confirm may stop then pilot | RETIRE (contradicted) | "drain-stops first": the code runs `runOperatorStop` = `kill_all_swarm.sh`. The living how-to also says drain-stop, so the disagreement is BL-2026's ruling, not retired silently. |
| 3 | /hydrate refuses when a full-pack role is up | WIRE | Live gate + `executeHydrate` / `fullPackPipelineRolesUp`. |
| 4 | Unauthorised sender cannot run a hard-tier verb | RETIRE (duplicate) | BL-702 same title, wired by BL-1940, BL-702 12/12 on main 2026-10-06. |
| 5 | Hard-tier verb outside Cursor Remote (or aligned Control) is ignored | RETIRE (duplicate) | BL-702 "Hard-tier verb outside Cursor Remote is ignored", same When/Then. |
| 6 | Hard-tier verb requires confirm before execute | RETIRE (duplicate) | BL-702, same text. |
| 7 | /confirm-off clears a pending hard confirm | RETIRE (duplicate) | BL-702, same text. |
| 8 | /restart relaunches after re-reading swarm.env | RETIRE (duplicate) | BL-702, same text. |
| 9 | /bounce bridge reloads swarm.env like /redeploy | RETIRE (duplicate) | BL-702, same text. |
| 10 | /syncenv reports key presence without values | RETIRE (duplicate) | BL-702's copy says "confirms" where this says "sends". /syncenv is soft tier, so BL-702's wording is the accurate one. |
| 11 | Soft lifecycle verbs need a light confirm before run | WIRE the /pull row; RETIRE three rows | /compile duplicates BL-702's soft-tier scenario. /doctor and /tunnel are READ_VERBS (`telegramCursorOperatorCore.ts`), with unit tests asserting they run with no confirm. |
| 12 | /drain-agents is distinct from /kill-all | RETIRE (contradicted) | "roles drain gracefully": `drainAgentSessions` is `tmux kill-session` per role, and its own docstring says "kill role tmux sessions only". Distinctness is unit-tested ("kill-all and drain-swarm execute paths"). |
| 13 | /stop offers drain-stop and emergency-stop modes | WIRE | `operatorStopModeButtons`, `executeStopMode`. |
| 14 | /ambulance engages and releases exclusive hold | WIRE | `engageOperatorAmbulance` / release. The fixture seeds `backlog/active/` (BL-691 D3). |
| 15 | /hold parks to backlog/hold and /reinstate restores | WIRE | `backlogWriter` `parkToHold` / `reinstateFromHold`. "sends" binds to the executor, the BL-704 precedent. |
| 16 | Holiday quiet refuses pilot/expedite with Run anyway | RETIRE (duplicate) | BL-704 "Holiday quiet refuses pilot with Run anyway", wired by BL-1939, 2/2 on main 2026-10-06. |
| 17 | Shift and holiday state round-trip under operator runtime | RETIRE (duplicate) | BL-704, same text. |
| 18 | /oncall me routes alerts to the principal | RETIRE (never built) | Only `formatOncallAlertLine` in the /ensure reply reads oncallId. BL-541 retired BL-704's identical scenario on the same grounds. |
| 19 | /hydrate wakes specifier only and stops on handoff to coder | RETIRE (never built) | The stop exists only as prompt text (`composeHydratePrompt`), and the how-to calls it a "prompt contract". The mechanism is BL-1054/BL-1055, both parked unbuilt in backlog/debt/. |
| 20 | /mint is an alias of /hydrate for intake minting | RETIRE (never built) | Its Then names #19's stop-on-coder-handoff path. The alias itself (`executeHydrate` takes both) is unit-level. |
| 21 | /autopilot dry lists high-priority specced tickets and defects | WIRE | `selectAutopilotQueue`. |
| 22 | /autopilot pilots the queue sequentially as Cursor /pilot | RETIRE (unwireable + contradicted) | "pilots the first ticket to completion" sits at the Cursor-model boundary, and `advanceOperatorBatch` advances after any turn, not on completion. Epic exclusion and the busy refusal are unit-tested. |
| 23 | /land dry lists in-flight tickets only | WIRE | `selectLandQueue`. |
| 24 | /land pilots in-flight tickets out then asks about sleep | RETIRE (unwireable + contradicted) | "to done" is the Cursor-model boundary. "only after that confirm does the swarm drain-stop" is false: the yes writes the swarm bounce sentinel (stop + relaunch). That defect is BL-2026. |
| 25 | Control topic accepts the same slash forms as Cursor Remote | WIRE | `telegramControlCore` /ambulance -> `engageOperatorAmbulance`. |
| 26 | How-to and Cursor Remote diagrams exist | RETIRE (meta) | A docs-exist claim. BL-541 retired BL-704's identical scenario. The files exist in living docs. |

Coverage note: retire, never reword. The nine duplicates keep their gate
in BL-702/BL-704, both green. The register row moved to BL-2025, which
wires the nine scenarios left.

## Observations recorded, not ticketed

- **The bounce sentinel has no headless consumer.** On this host
  `.swarmforge/bounce` has read "swarm" since 2026-10-05 21:59, and
  `.swarmforge/bounce-ack.json` was last written 2026-08-22. Only the VS
  Code extension host consumes it (`bounceWatcher.ts`), and
  `remote_bounce.sh` only writes it. /restart and /bounce swarm honestly
  reply "sentinel written". A host-agent session (Cursor) consumed it by
  hand on 2026-10-05. That is the incarnation doing the owning context's
  job (local-engineering rule 7), so it is not ticketed. If the human
  wants a headless consumer, it is a new ticket.
- **/drain-agents uses a bare target.** `buildKillSessionArgs` passes a
  bare `-t <session>`, the prefix-match shape 77584c4c11 fixed in the
  repair path. Here every listed agent session is being killed anyway, so
  the effect is at most a miscount. Not ticketed.
- **Control's /kill-all needs no confirm.** `telegramControlCore` maps a
  typed /kill-all straight to `execute-emergency-stop` with no confirm.
  That is BL-423's Control design, which predates BL-698, and BL-698's
  confirm-gate scenarios cover the Host topic. Recorded so a reader does
  not take the two surfaces as aligned on confirms.

## Outcome

BL-2023 closes with the work split: BL-2025 (wire BL-698's nine) owns the
remaining register row. BL-2026 (the stop-answer defect) was found here.
Register: four BL-2023 rows -> one BL-2025 row.

By specifier.
