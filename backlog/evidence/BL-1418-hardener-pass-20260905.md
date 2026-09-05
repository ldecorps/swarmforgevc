# BL-1418 — hardener pass, 2026-09-05

Ticket: BL-1418-the-art-director-seat-is-addressable
Commit reviewed: 7eeb3ac6ff (architect NONE pass, parcel)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npm run compile` (run first, per the architect's noted stale-build trap) | clean |
| `node specs/pipeline/cli.js specs/features/BL-1418-...feature` | 7/7 pass |
| `npx vitest run test/{pipelineBoard,epicIcon,roleTopicMapStore,topicIcon,telegramFrontDeskBotCli,bl1418RoleEnumerationClassification}.test.js` | 468/468 pass |
| `npx vitest run --config vitest.properties.config.mjs test/{bl1040SeatIdentityObservationPath,bl946EpicIconPoolInvariants,pipelineBoard}.property.test.js` | 20/20 pass |
| `bb swarmforge/scripts/test/model_factory_test_runner.bb` | ALL PASS |
| `bash swarmforge/scripts/test/test_model_factory_cli.sh` | ALL PASS (16/16) |
| `bb swarmforge/scripts/test/pack_staffing_gate_lib_test_runner.bb` | all assertions passed |
| `bash swarmforge/scripts/test/test_remote_control_health.sh` | ALL PASS |
| `bash swarmforge/scripts/test/test_swarmforge_pack_export.sh` | ALL PASS |
| `npx jscpd` on the two new files | 0 clones |
| `node out/tools/mutation-site-count.js` on the 3 touched TS files | 1011/13/51 — matches exactly; `pipelineBoard.ts`'s "over" verdict independently confirmed pre-existing (1629 lines before this ticket's diff, `git show d8690e2995^:...\|wc -l`) |
| `grep -n "🎨\|🔮" topicIcon.ts epicIcon.ts` | 🎨 confirmed as `epicIcon.ts`'s own 5th `ORIGINAL_POOL_ORDER_PREFIX` entry; 🔮 present only in `topicIcon.ts`'s new `art-director` entry |
| Read the full `ROLE_TOPIC_ICON` map (all 9 entries) | all nine values visually distinct: 📣📝🏛💻🧼🧪🔎📰🔮 |
| `grep -c art-director` on the four chain-list files (`rolePack.ts`, `swarmMetrics.ts`, `required_stages_lib.bb`, `routing_manifest_lib.bb`) | 0/0/0/0 — none contains it |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently confirmed the pipelineBoard.ts collateral fix

Read the diff directly:
`rawRole === 'coordinator' || rawRole === 'art-director' ? 'QA' : rawRole`
(line 558) — correctly extends the SAME pre-existing coordinator-remap
mechanism to the new non-chain role, matching every prior role's own
reading. `PIPELINE_BOARD_COLUMN_ORDER` itself is untouched (confirmed by
reading its definition), so this is a separate remap mechanism, not an
addition to the chain-list invariant 1 forbids touching.

## BL-113 hard gherkin mutation: clean

One `Scenario Outline` (scenario 03, 4 examples, 1 mutable column each =
4 mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals
explicit, workdir removed after). Result: **4 mutants, 4 killed, 0
survived** — manifest confirms
`"Total":4,"Killed":4,"Survived":0,"Errors":0"`. Scenarios 01, 02, 04 are
plain `Scenario:` blocks, not mutation targets.

## Design/CRAP/DRY

Mutation-site-count "over" threshold only on `pipelineBoard.ts`,
independently confirmed pre-existing (1629 lines before this ticket's
one-line diff) — same class as BL-1425's own pre-existing-hub-file
finding earlier this session, not created by this parcel. The two other
touched files (`roleTopicMapStore.ts`, `topicIcon.ts`) are both within
threshold. jscpd confirms zero duplication in the two new files.

## Noted, not re-sent: architect's own out-of-parcel finding

The architect's evidence already flagged (via a priority-00 note to
specifier and coordinator) that `qa_e2e_procedure` step 5 cannot pass as
literally written today — `models.seed.json` carries no `role_matrix`
entry for `art-director`, so `assign --mode quality` omits it from its
output (a clean degrade, not a crash, per `assign-swarm`'s own doc
comment). This is not a defect in this parcel's own code (the coder
correctly filed the seed entry as out of scope — a certified-evidence
artifact, not something to fabricate) and is already routed to the
correct owners. Not chased further here.

## Verdict

No defect. Forwarding to documenter.
