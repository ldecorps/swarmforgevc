# BL-1081-an-acp-host-in-a-pane-can-drive-one-seat — QA pass — 20260823

Documenter tip merged: `fc40724221`. Hardener `1bb78e6621`, coder launch `1fe9f295ec`,
and disentangle `7f00b31256` are ancestors of the cited tip (asserted before
approve).

## Review inventory (Article 4.4)

NONE.

## Gates run

- Sibling check: `VERIFY BL-1081` (exit 0).
- Prior spawn-wiring bounce (`f52ed3a84e` / evidence
  `BL-1081-an-acp-host-in-a-pane-can-drive-one-seat-bounce-20260823.md`):
  **CLEARED** — `write_role_launch_script` vibe branch launches
  `extension/out/tools/acp-host-pane.js` as the pane process; host writes
  `.swarmforge/acp/<role>.json`.
- Prior mkdtemp bounce (`bf40f9688`): **CLEARED** —
  `acpHostPane.test.js` uses `mkTmpDir('bl1081-acp-host-')`.
- Architect bounce2 entanglement (`e5e40d5eb`): **CLEARED** —
  `origin/main...HEAD` has no BL-1052/BL-1082 / `modelServing` / local-model
  paths; `index.js` registers only `bl1081AcpHostDrivesOneSeatSteps` from that
  cluster.
- `cd extension && npm run compile`: clean.
- Unit (`cd extension && set -a && . /home/carillon/swarmforgevc/.swarmforge/swarm.env && set +a && node scripts/recordTestDuration.js`):
  parcel-green. Standing outside-parcel reds only —
  `sampleResourcesCli.test.js` (3) and `strykerSandboxSiblingsLib.test.js` (4);
  neither path is in `origin/main...HEAD`. Local intake already filed at
  `.swarmforge/operator/INTAKE-unit-suite-sampleResources-strykerSandbox-standing-red.md`.
  All BL-1081 ACP unit files green (acpHostPane 14, acpSeatLaunch 6, etc.).
- Properties (`cd extension && npm run test:properties`): 164 files / 480
  tests green, including `bl1081AcpHostLaunch`,
  `bl1081PaneTranscriptSurvives`, `bl1081StructuredSeatControl`. Two
  `[vitest-worker]: Timeout calling "onTaskUpdate"` — known benign artifact,
  allowlisted.
- Acceptance: `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1081-an-acp-host-in-a-pane-can-drive-one-seat.feature` —
  5/5 pass.
- Babashka: `bb swarmforge/scripts/test/acp_session_lib_test_runner.bb` ok;
  `bb swarmforge/scripts/test/bl1081_acp_snapshot_agreement_test_runner.bb` ok;
  `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb` ok.
- `required_wiring` `specs/pipeline/steps/index.js::bl1081`: registered;
  exercised by acceptance.
- `required_wiring` live decision site (`babysitter_check.bb` `gather-role` →
  `acp_session_lib/apply-acp-facts`; `babysitterd_sweep_lib.bb`
  `check-acp-seat` / menu-check gating): present and covered.
- Ticket invariants: structured stop-reason / permission path encoded in
  property + acceptance scenarios 01–02; pane transcript + babysitter verdict
  in scenario 03; shared handoff helper in 04; `:acp` dimension on provider
  table in 05. Spike seat is vibe only (`acp-hosted-spike-seat?` /
  `shouldLaunchViaAcpHost`); cursor/claude/gemini launch bodies unchanged.
- Orphans: no leftover `node --test` / `stryker` after gates.

## Intent

One ACP-native seat (vibe) is driven through an in-pane ACP host that exposes
stop reason and permission requests to the babysitter; pane transcript and
shared handoff helpers remain. Matches the ticket.

By QA.
