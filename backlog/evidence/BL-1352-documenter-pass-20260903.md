# BL-1352 — documenter pass, 2026-09-03

Merged hardener commit `bca443a59b` — this merge auto-resolved cleanly (no
conflict in `specs/pipeline/steps/index.js` this time; the BL-1352 require
line was already present ahead of BL-1335's from an earlier main-sync).

## Doc review

- Diff scoped to `swarmforge/scripts/swarm_status.bb`,
  `swarmforge/scripts/swarm_status_lib.bb`, `swarmforge/scripts/operator_runtime.bb`,
  `swarmforge/scripts/role_ask_escalation_lib.bb` — a new `./swarm status`
  row and an operator-log behavior change, both user/operator-visible. No
  new extension command or setting.
- `docs/how-to/GH-25-email-escalation-for-unanswered-role-questions.md`
  directly described the now-fixed defect: it said the tick "logs a
  warning" per tick (the per-tick WARN is now deleted, logged on state
  change only) and its `status.json` shape section didn't mention the new
  `state`/`detail`/`waiting_roles` keys. This is exactly the class of stale
  doc BL-1352 makes wrong on arrival — updated with a new "Transport
  visibility (BL-1352)" section, corrected the "logs a warning" claim, and
  cross-linked BL-1347/BL-1352's acceptance features. Committed with an
  untagged subject (task-scope gate, BL-1192 — the file basename names
  GH-25, not BL-1352).
- Diagram check: `architecture.mmd`'s change-trigger is the extension
  host/webview boundary, the tmux substrate relationship, or the
  `.swarmforge/` state layout. The diagram does not enumerate individual
  operator state files (no babysitterd-watchdog.json node either) — a new
  same-shaped `ask-escalation-transport.json` last-state file doesn't
  change what the diagram depicts. No diagram edit required.

## Action taken

- Added a dated entry to `docs/reference/Specification.MD` (commit
  `a239730451`) covering: the two-halves-of-the-defect shape (silent
  degradation + log flood), the three-way status row
  (ok/warn/FAULT) and its always-rendered/fail-to-unknown posture, the
  log-on-change fix reusing the babysitterd watchdog's pattern, and the
  cleaner bounce (flaky property reach floor, no production-code change on
  rework). `**Last Updated**` bumped in the same commit.
- Updated the GH-25 how-to (commit `2fe1549e2e`, untagged subject) with the
  new transport-visibility behavior and an `./swarm status` check command.

## Verdict

No documenter-domain defect found. Forwarding to QA.
