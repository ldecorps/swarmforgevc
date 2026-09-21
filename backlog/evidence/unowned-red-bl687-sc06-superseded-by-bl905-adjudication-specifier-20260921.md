# Adjudication: unowned red, BL-687 feature scenario 06 - superseded by BL-905 (2026-09-21, specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T12:15:03Z
(00_20260921T121503Z_000037_from_coder): "unowned-red BL-687-epic-reorder
feature sc08 (drilled-into BL-517) fails" ("sc08" is the TAP index; the
scenario is `# BL-687 epic-reorder-includes-active-children-06`).

**Confirmed on main, one run** (7fdd96e8d8, 12:15Z,
`specs/pipeline/scripts/run_acceptance.sh specs/features/BL-687-epic-reorder-includes-active-children.feature`):
`not ok 8 - An epic whose only child is done drills down to the
reorderable-topics empty state` / `failed at step "When the "BL-517" tile
is drilled into": expected a drill button for epic BL-517`; `# pass 8`,
`# fail 1`. The fixture is the feature's own (a mkdtemp backlog with epic
BL-517 and one done child BL-660) - not the live backlog.

**Successor.** The drill button renders for every tile
(`extension/src/bridge/epicReorderUiHtml.ts` ~213, blame 2026-07-26,
unchanged). The tile list is `filterEpicsWithTopics` in
`readEpicReorderMembership` (`bridgeServer.ts` ~1085): "a childless epic
never appears as a tile AND never acts as a Move up / Move down
neighbour". `git log -S'childless'` names 0f5394a2d0 (2026-08-16) "Land
hide-childless-epics reorder screen fix (BL-905 stamp-off; human-approved
hotfix landing)": "Human wants shell epic trackers (no live children)
excluded from the Reorder epics tile list and its Move up/Move down
neighbours, so a tap cannot land on an invisible shell." BL-905
(`backlog/done/M8/`) pins it in
`specs/features/BL-905-hide-childless-epics-reorder.feature`: "An epic
with no live children is not listed". BL-687's scenario 06 states the
pre-BL-905 present (BL-1006's shape: the successor left the boundary
assertion standing); red since 2026-08-16, unrun by any lane (no landed
features lane until BL-1625 lands).

**Ruling.** Retire scenario 06, never reword (BL-905's scenario is the
coverage); drop the handler's `the drill-down shows` step only if no
feature references it afterwards; the "tile is drilled into" step stays
(scenarios 01-05, BL-674, BL-686). Owner: **BL-1658** (active, promoted
2026-09-21 12:55 local, not yet dequeued), which already edits
`bl687EpicReorderIncludesActiveChildrenSteps.js` for the jsdom move -
amended with `retires:` and the second amendment section; a separate owner
would queue behind it on orthogonality (human directive 2026-09-17: fewer
tickets). Register row added for the feature file; first sighting
2026-09-21 (the coder's changed-path census; BL-1630's 2026-09-20
out-of-scope findings do not name it).

**Interim.** A red on this feature's TAP 8 alone is this owned red: one
run, record the line, never a bounce for a parcel touching neither BL-687's
handler nor the reorder screen.

By specifier.
