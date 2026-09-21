# BL-1641: lineage fix (QA bounce D1) — coder

QA's bounce (`backlog/evidence/BL-1641-qa-bounce-20260921.md`) found
`pre_qa_gate.sh` refusing on ancestry: the parcel that reached QA (built
from the documenter's `8fbd62bff5`) diverged from the coder's own fix
commit `ee58ac07b3` ("mainHasBriefing now actually fails closed on a git
read error") before it landed - so QA received a `mainHasBriefing` that
still fails OPEN, the exact defect the architect already bounced and the
coder already fixed on a lineage that never reached QA.

## Verified

- `ee58ac07b3` IS an ancestor of this worktree's current HEAD
  (`git merge-base --is-ancestor ee58ac07b3 HEAD`).
- `mainHasBriefing` in `extension/src/tools/night-closing-ceremony-run.ts`
  carries the fix (the `GIT_PATH_ABSENT_FROM_MAIN_PATTERN` stderr check,
  not a bare `catch { return false; }`).
- Fresh `npm run compile` + `npx vitest run test/nightClosingCeremonyRun.test.js`:
  20/20 pass.
- `bash swarmforge/scripts/test/test_bl1641_ceremony_deadline_produces_a_briefing.sh`:
  11/11 PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1641's feature: 4/4.
- `bash swarmforge/scripts/test/test_compose_banked_briefing_cli.sh`: 4/4 PASS.
- `npx vitest run --config vitest.properties.config.mjs test/bl1641EnsureBriefingInvariants.property.test.js`:
  2/2 pass.

## Fix

No new production/test edits this pass - this worktree's own current tip
already carries the correct lineage (built directly on `ee58ac07b3` this
session, never diverged from it). The defect was the OTHER
(documenter's-`8fbd62bff5`-based) lineage QA happened to receive, not
this one. Re-sending a fresh `git_handoff` for BL-1641 from this
worktree's current tip, through the normal chain, is the whole fix -
this commit exists only to record that verification and give the
forward a real, ancestry-clean commit to name.
