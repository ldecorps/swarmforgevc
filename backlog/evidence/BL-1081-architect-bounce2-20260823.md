# BL-1081 architect bounce 2 — 2026-08-23

Commit reviewed: `2bd7ff5f0d` (cleaner tip, merge of coder
`c63a0cd2ba` "BL-1081: route acpHostPane test temps through mkTmpDir").
Merged into architect as `cf58924a2`, then reverted (`4c334c753`, `-m 1`)
so the architect branch does not retain the out-of-scope content (BL-490).

## Review inventory (Article 4.4 — one bounce)

### Gates run

- Dependency gate (`extension/` cwd,
  `node out/tools/dependency-gate.js` on ACP host modules + `modelServing.ts`):
  PASSED — no forbidden edges on either the BL-1081 ACP surface or the
  entangled BL-1082 module.
- Co-change report on ACP host files: expected ACP cluster (host / args /
  plan / session / babysitter / property tests). Informative only; no new
  architectural boundary breach inside the ACP set.
- Declared invariants 1–2: property files present and green —
  `bl1081AcpHostLaunch.property.test.js`,
  `bl1081PaneTranscriptSurvives.property.test.js`,
  `bl1081StructuredSeatControl.property.test.js` (3/3 via
  `npm run test:properties` scoped run). Non-vacuity already recorded
  in-file from the prior coding pass.
- Prior QA bounce D1 (raw `mkdtemp` in `acpHostPane.test.js`): **CLEARED**
  at `c63a0cd2ba` — file routes through `mkTmpDir('bl1081-acp-host-')`;
  `tmpDirMigrationGuard.test.js` + `acpHostPane.test.js` 25/25 green.
- Launch wiring (prior QA spawn bounce `f52ed3a84e`): still an ancestor;
  `swarmforge.sh` vibe branch still names `acp-host-pane.js`;
  `babysitter_check.bb` `gather-role` still consults `acp_session_lib`.
- Property-coverage support pass for this hop: no new property needed —
  the intentional delta is a two-line test-fixture helper swap.

### D1 — BL-1081 tip carries held BL-1052 / BL-1082 work (behavior / scope, blame: coder)

BL-506: a parcel authorizes ONE ticket. `2bd7ff5f0d`'s second-parent lineage
includes, after the prior architect pass `5d7ae7806` and before the mkTmpDir
fix:

- `b2b80fb7c` — BL-1082 named model pull/serve helpers
- `770339063` — BL-1052 local-model seat staffing

Both tickets sit in `backlog/hold/` (not active). Neither is named on this
handoff. Relative to architect tip before the merge (`f62311c54`), the merge
newly introduced at least:

- `extension/src/swarm/modelServing.ts` (+ unit/property tests)
- `specs/pipeline/steps/bl1052LocalModelSeatSteps.js`
- `specs/pipeline/steps/bl1082NamedModelServingSteps.js`
- `require('./bl1052…')` / `require('./bl1082…')` in
  `specs/pipeline/steps/index.js` (mixed into the same edit that already
  carried `bl1081AcpHostDrivesOneSeatSteps`)
- `swarmforge/packs/local-model-mono-router.{conf,prompt}`
- `swarmforge/profiles/{cheap-copilot-seven-pack,mono-router-gpt,stabilize-two-pack}.*`
- `swarmforge/scripts/test/test_local_model_seat.sh`
- `swarmforge/scripts/test/bl1052_local_model_seat_property_runner.bb`
- `local-model` agent entries in `prompt_engine_lib.bb` (explicitly commented
  BL-1052 / BL-1082)

Hardener → documenter → QA already walked a tip that contained this
entanglement and bounced only the mkdtemp guard. That does not authorize
forwarding: Article 2.6 requires each satisfied ticket as its own
`git_handoff`; hold-queue work must not ride a BL-1081 re-entry.

#### Remediation

1. On the coder worktree, rebuild a BL-1081-only tip whose unique commits
   are the ACP-host spike + the mkTmpDir guard fix (`c63a0cd2ba` /
   `bf40f96885` lineage) — without BL-1052 / BL-1082 commits, packs,
   profiles, step handlers, or `local-model` provider-table rows.
2. Leave BL-1052 / BL-1082 on their own branches / hold disposition until
   the coordinator promotes them; if they are ready, forward each as its
   own parcel under its own task name.
3. Re-hand to cleaner → architect with a tip whose `git diff` against the
   pre-entanglement ancestor names only BL-1081 paths.

### Five fields (D1)

1. **Failing command / check:**
   `git log --oneline <architect-pre-merge>..<cleaner-tip>` and
   `git diff --name-only <architect-pre-merge>..<cleaner-tip>` — surfaces
   `modelServing.ts`, `bl1052*`, `bl1082*`, `local-model-mono-router*`.
2. **Commit hash:** `2bd7ff5f0d` (reviewed cleaner tip).
3. **First error excerpt:** N/A (scope gate, not a red suite). Evidence is
   the path list above plus hold-queue ticket locations.
4. **Blame:** coder (contaminated re-entry tip after QA bounce fix).
5. **Remediation pointer:** disentangle per steps 1–3 above; do not ask
   architect/hardener to cherry-pick.

## Cleared / not defects

- Architecture of the ACP host itself (two-layer boundary, host owns I/O,
  pane is transcript view, no webview storage, secrets stay host-side):
  unchanged and still compliant from the prior clean pass.
- mkTmpDir migration for `acpHostPane.test.js`: fixed.
- Untracked `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`
  in this worktree: ticket-less local artifact, surfaced not swept.
