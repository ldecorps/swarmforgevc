# BL-1418 — architect pass, 2026-09-05

Ticket: BL-1418-the-art-director-seat-is-addressable
Role: architect
Commit reviewed: 53b8f9cc34 (cleaner NONE pass)

## Result: NONE (parcel) — no architecture, invariant, or correctness
defect in this parcel. One qa_e2e spec-gap recorded below and routed as a
note, per this role's out-of-parcel/spec-gap rule.

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd**, independently re-run on the two new files: `0 clones`.
- **mutation-site-count**, independently re-run: `pipelineBoard.ts` 1011
  (over threshold), confirmed pre-existing at 1629 lines before this
  ticket's one-line diff (`git show <parent>:<path> | wc -l`) — same class
  as BL-1425's own pre-existing-hub-file finding earlier this session, not
  created by this diff. `roleTopicMapStore.ts` (13) and `topicIcon.ts`
  (51) both within threshold.
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family — correctly, this is a fresh feature.

## First run showed 1 failure — traced to my own stale build, not a defect

Same class as I hit reviewing BL-1425 earlier today: my first acceptance
run showed 1/7 failing; `npm run compile` (needed after several
revert/restore cycles for other tickets' non-vacuity checks this session)
fixed it — **7/7 pass**, stable across two further runs. Not a defect in
the parcel.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"Every enumeration of swarm roles... names art-director exactly as
   roles.tsv spells it... or is explicitly a pipeline-chain list... and
   stays untouched"** — independently confirmed the three swarm-roles
   lists gained `art-director` (`ALL_SWARM_ROLES`, `ROLE_TOPIC_ICON`/
   `RoleTopicIconRole`, `model_factory_lib.bb`'s `swarm-roles`) and the
   chain lists did not: `grep art-director` on `rolePack.ts`
   (`PIPELINE_CHAIN`), `swarmMetrics.ts` (`PIPELINE_ORDER`),
   `required_stages_lib.bb`, `routing_manifest_lib.bb` — no match in any
   (exit 1). The `pipelineBoard.ts` change is a SEPARATE mechanism (the
   coordinator-remap, extended to art-director for the identical
   out-of-chain reason) — not an addition to `PIPELINE_BOARD_COLUMN_ORDER`
   itself, confirmed by reading `PIPELINE_BOARD_COLUMN_ORDER`'s own
   definition (`[PIPELINE_BOARD_NOT_STARTED_COLUMN, ...PIPELINE_CHAIN]` —
   untouched).
2. **"The seat shape... changes only the pack window line... mailbox,
   worktree, prompt composition, topic and role lists are identical under
   every option"** — confirmed structurally: none of the role-list/icon/
   model-factory edits reference the ruling option at all; they are
   unconditional additions.
3. **"The art director topic icon collides with no other role topic
   icon"** — independently verified the collision reasoning: `grep -n
   "🎨\|🔮" extension/src/concierge/topicIcon.ts
   extension/src/concierge/epicIcon.ts` confirms 🎨 IS
   `epicIcon.ts`'s `ORIGINAL_POOL_ORDER_PREFIX`'s 5th fixed entry, and 🔮
   appears nowhere else in either table — the rejection of the obvious
   pick and the chosen alternative are both independently confirmed, not
   merely asserted. Also confirmed 🔮 is present in the live 112-sticker
   set (`forumTopicIconStickerSet.ts`) and does not collide with any other
   `ROLE_TOPIC_ICON` value (read the full map: all nine values distinct).

## Independently re-verified the substance

- `node specs/pipeline/cli.js
  specs/features/BL-1418-the-art-director-seat-is-addressable.feature` —
  **7/7 pass**, twice.
- `npx vitest run test/{pipelineBoard,epicIcon,roleTopicMapStore,topicIcon,telegramFrontDeskBotCli,bl1418RoleEnumerationClassification}.test.js`
  — **468/468 pass**.
- `npx vitest run --config vitest.properties.config.mjs
  test/{bl1040SeatIdentityObservationPath,bl946EpicIconPoolInvariants,pipelineBoard}.property.test.js`
  — **20/20 pass**.
- `bb swarmforge/scripts/test/model_factory_test_runner.bb` — **ALL PASS**.
- `bash swarmforge/scripts/test/test_model_factory_cli.sh` — **ALL PASS**
  (16/16).
- `bb swarmforge/scripts/test/pack_staffing_gate_lib_test_runner.bb`,
  `bash .../test_remote_control_health.sh`,
  `bash .../test_swarmforge_pack_export.sh` — **ALL PASS** on each.

All matching both the coder's and cleaner's claimed counts exactly.

## Collateral fix scope judgment

Agree with the `pipelineBoard.ts` coordinator-remap extension to
art-director: `ALL_SWARM_ROLES` growing to 9 members would otherwise
falsify `pipelineBoard.property.test.js`'s own "every role renders on a
real column" property for the new role — correctly caught by that
pre-existing property test rather than missed, and fixed with the
identical mechanism already established for `coordinator`, not a new one.
The three other collateral test-count updates
(`roleTopicMapStore.test.js`, `telegramFrontDeskBotCli.test.js`,
`bl1040SeatIdentityObservationPath.property.test.js`) are mechanical
8→9-member adjustments, independently confirmed passing above.

## Out-of-parcel finding: qa_e2e_procedure step 5 cannot pass as literally written today

The ticket's own `qa_e2e_procedure` step 5 reads: `bb
swarmforge/scripts/model_factory_cli.bb assign --mode quality lists
art-director`. I ran this directly against the real, unmodified
`models.seed.json`:

```
bb swarmforge/scripts/model_factory_cli.bb assign --mode quality
```

Result: `art-director` is **absent** from the JSON output (confirmed by
reading the full result — architect, coder, cleaner, QA, hardender,
documenter, specifier only). This is not a defect in this parcel's own
code: the coder's evidence transparently states `swarm-roles` was
extended, but no `models.seed.json` `role_matrix` entry was added for
`art-director`, explicitly filed as out of scope ("a certified-evidence
seed entry, not something to fabricate"). `assign-swarm`'s own doc comment
confirms a role with no eligible candidate is simply absent from the
result map — a clean degrade, not a crash — which I independently
reproduced above (the CLI ran without error, just without the new role in
its output).

This means qa_e2e step 5, as literally written, is **not satisfiable at
this parcel's own commit** — QA would need either a `models.seed.json`
entry added first (which requires real compliance-battery evidence per
this project's own convention, not something a QA gate should fabricate)
or the step's own wording amended to say what it can actually check today
(e.g. "the role appears with no eligible candidate, absent rather than
erroring"). Neither the coder's nor the cleaner's evidence sent a note
about this gap — both correctly identified and explained the underlying
cause but stopped at "out of scope" in their own written evidence rather
than flagging it forward. Sending a `note` (priority `00`) to specifier
and coordinator alongside this pass, per this role's spec-gap rule
(the same class as BL-1206's and BL-1212's out-of-parcel findings earlier
this session).

## required_wiring

All three anchors confirmed present: `full-forge.conf`'s `window
art-director` line; `topicIcon.ts`'s `art-director` icon entry; the new
step handler discovered by directory scan (BL-1371), confirmed by the
acceptance run passing 7/7.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect in the parcel. Forwarding to hardener;
separately notifying specifier + coordinator that qa_e2e_procedure step 5
cannot pass as literally written without a `models.seed.json` seed entry
this ticket correctly declined to fabricate.
