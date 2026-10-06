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

## BL-703 and BL-698

Pending in this pass. BL-703 is "Slice 2 of BL-698", and its nine scenarios
appear among BL-698's 26 by title. Per-scenario liveness evidence for
BL-698 is being gathered, and the outcome will be appended here.

By specifier.
