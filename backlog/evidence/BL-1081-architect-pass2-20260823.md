# BL-1081 architect pass — 2026-08-23 (re-entry after bounce2)

Reviewed parcel: `80f8b02029` (cleaner merge of coder `7f00b31256`
"BL-1081: disentangle held BL-1052/BL-1082 from the ACP host tip").

## Review inventory

NONE.

## Evidence

- **BL-506 / bounce2 D1 cleared:** tip no longer carries
  `modelServing.ts`, bl1052/bl1082 step handlers, local-model packs/profiles,
  or `local-model` provider-table rows. Diff against the contaminated prior tip
  deletes those paths; worktree confirms `modelServing.ts` absent.
- **Prior QA mkdtemp bounce cleared:** `acpHostPane.test.js` uses
  `mkTmpDir('bl1081-acp-host-')`; `tmpDirMigrationGuard` + host unit tests
  25/25 green.
- **Prior spawn-wiring bounce** (`f52ed3a84e`) is an ancestor;
  `swarmforge.sh` vibe branch launches `acp-host-pane.js`;
  `babysitter_check.bb` `gather-role` loads `acp_session_lib` and applies
  structured facts.
- Dependency gate PASSED on ACP host modules (no forbidden edges).
- Co-change: ACP host cluster co-moves as expected (args/plan/session/
  babysitter/tests). Historical co-change with BL-1052/1082 paths at
  frequency 2 only — informational; those files are not in this tip.
- Declared invariants: non-vacuous property coverage present and green
  (`bl1081AcpHostLaunch`, `bl1081PaneTranscriptSurvives`,
  `bl1081StructuredSeatControl` — 3/3 via `test:properties`).
- Architecture: ACP host is a pane CLI (`acp-host-pane.ts`) spawning the
  agent as subprocess over stdio — substrate stays tmux/pane; no webview
  storage; host owns I/O. Two-layer boundary respected.
- Property-coverage support pass: no new property needed on this re-entry
  (disentangle + prior coverage already encode the declared invariants).

Forward to hardender.
