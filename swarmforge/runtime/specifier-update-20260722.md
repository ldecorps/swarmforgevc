# Specifier update — 2026-07-22

Backlog root fully drained. Summary for coordinator bookkeeping/promotion:

- **BL-525**: duplicate/stale entry fixed (prior session). Promote first.
- **GH-22** (paused, priority 03): context telemetry recorder + query CLI.
  Promote after BL-525 lands in `done/`. `epic: swarmforge-console`,
  `milestone: M8`.
- **GH-23** (paused, priority 04, `depends_on: [GH-22]`): Console Mini App
  Context Budget dashboard, Slice 1 (numeric/text, empty-state required).
  Promote after GH-22.
- **BL-558** (paused, `type: epic`, priority 00): GitHub auto-intake
  adapter epic tracker — do NOT promote directly.
- **BL-560** (paused, priority 20): Slice 1 of BL-558 — scheduled GitHub
  Actions scan workflow. This is the promotable child once the epic's
  turn comes; no hard ordering dependency on GH-22/GH-23, orthogonal
  (different files: `.github/workflows/`, no TS/webview overlap).
- **BL-559** (paused, priority 40, `type: defect`): pipelineBoard property
  test has a stale substring assertion (diagnosed, not yet fixed) —
  low-cost, orthogonal to the above, safe to slot in whenever there's an
  open cycle.
- **BL-548** and **BL-556**: both now carry a durable `promotion_blockers:`
  field — do not promote either ahead of GH-22 reaching `backlog/done/`
  (human directive 2026-07-22, now encoded on the tickets themselves; the
  source INTAKE-*.md files that carried this directive have been drained
  and removed from backlog root).
- Two other backlog-root INTAKE-*.md docs (intelligence-layer-routing —
  superseded; github-auto-intake-adapter — now BL-558/BL-560) were fully
  drained and removed in the same pass.
- Also filed/closed as no-ops: two test-failure mailbox reports
  (telegramFrontDeskBotCli, a vague "5 pre-existing failing tests" report)
  did not reproduce on current `main` HEAD — no ticket filed for either.

Backlog root is now empty (only README.md/STEERING.md remain).
