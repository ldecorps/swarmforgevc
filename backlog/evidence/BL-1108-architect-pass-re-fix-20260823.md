# BL-1108 architect pass (QA bounce re-fix)

- Reviewed commit lineage: cleaner `7dd654ec1e` (DRY `rc-non-claude-off-action`)
  on coder `a17bfd746f` (agent-aware `rc-absent-report`) fixing QA bounce D1 on
  tip that had held documenter `9d0264d9c3` / hotfix `f02f6ae5b4`.
- Prior bounce (read from parcel evidence; not yet on `main`): Claude seat with
  no `--remote-control` must stay HEALTHY (BL-514 RC-6); non-Claude stays OFF
  (invariant 2). Confirmed fixed: `test_swarm_ensure.sh` RC-6 and RC-6b PASS;
  full suite ALL PASS.
- Forward commit: this evidence commit (received `7dd654ec1e` is ancestor).
- Inventory: NONE
- Dependency-rule gate: no `extension/src` paths in this re-fix parcel
  (`swarm_ensure.bb` + `test_swarm_ensure.sh` only) — N/A for parcel edges.
  Full-repo scan still shows standing `telegram-front-desk-bot` ↔
  `telegramCursorOperator*` acyclic debt — **BL-759**
  (`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`);
  not introduced here.
- Co-change: intentional `swarm_ensure.bb` ↔ `test_swarm_ensure.sh` coupling;
  no new architectural fan-out to bounce.
- Invariants: both still encoded in `bl1108CursorSeatReadiness.property.test.js`;
  green via vitest.properties (2/2). Ensure-path Claude/non-Claude absent-flag
  arms locked by RC-6 / RC-6b (example suite) — no new undeclared property
  manufactured for the trivial `rc-absent-report` branch.
- Architecture: single shared marker map via `agent_process_marker_lib`;
  `rc-absent-report` branches on `role-agent-token`; cleaner DRY of OFF action
  string. No tile/host boundary breach; no process-spawn-from-TS; secrets/IO
  remain host-side.

By architect.
