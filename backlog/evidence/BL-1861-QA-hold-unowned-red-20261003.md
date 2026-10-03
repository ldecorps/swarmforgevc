# BL-1861 — QA hold: unowned acceptance red, 2026-10-03

Parcel commit: 83e865c455 (documenter rework of QA's D1, 1cf30cfacf)
Red: specs/features/BL-096-velocity-burndown-metrics.feature

- Met while re-checking the diagram-reading features for this rework:
  `node specs/pipeline/cli.js specs/features/BL-096-velocity-burndown-metrics.feature`
  -> `# pass 0 # fail 8`, twice, the same text each time (deterministic). Verbatim, scenario 1:
  `Scenario "velocity series matches git-recorded closes": no step handler matched "Given a repo whose history contains tickets closed into done/ on known dates"`.
  All 8 scenarios fail the same way: the feature has no step handler at all.
- The file is on origin/main; its ticket BL-096 is in backlog/done/. No open
  ticket names it (`git grep BL-096-velocity-burndown-metrics origin/main -- backlog/`
  finds only the done YAML); no register row. Under the 2026-09-05 amendment
  (rule 1: "a test that fails on main in any lane (... acceptance)") it is an
  unowned standing red, so approval waits for its owner (rule 3).
- The parcel itself passes: D1 cleared (architecture.mmd now draws
  local_llm.sh remove and .swarmforge/local-llm/removed.json, 2fa0d800a6).
  Since QA's first pass the rework changes only that diagram and the
  documenter's evidence. Re-run on 83e865c455: sibling VERIFY, register 0
  (`unowned: []`), pre_qa_gate OK, renderBriefingDiagramsCli + docsTree unit
  56/56, companionManifest property 2/2, BL-581 4/4, BL-260 5/5 (the
  diagrams render), BL-1861 8/8. The first pass's unit/property/acceptance
  rows (b428ddfeb7, all 0) stand for the unchanged paths.
- Disposition: unowned-red note to specifier + coordinator; the parcel waits
  for an owner, then resumes on 83e865c455.

By QA.
