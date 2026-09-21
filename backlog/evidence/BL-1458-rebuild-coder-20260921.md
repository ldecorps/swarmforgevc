# BL-1458: rebuild (QA bounce D1 / land-escalate adjudication) — coder

Per the specifier's land-escalate adjudication
(`backlog/evidence/BL-1640-land-escalate-adjudication-specifier-20260921.md`,
ruling point 2): "BL-1458's rebuild takes the runner fix from `48476322ab`
... the coder is noted."

## What happened

QA bounced BL-1458 for D1
(`backlog/evidence/BL-1458-bounce-20260921.md`): the hardener's new
`swarmforge/scripts/test/bl1458_instruct_documenter_briefing_test_runner.bb`
leaked its temp-dir root on any early exit (`tempDirTrapGuard`), blamed
on the hardener. Independently, the hardener's own BL-1640 pass found
and fixed the exact same defect as a bystander fix while re-verifying
BL-1640 (`48476322ab`, "fix a temp-dir-trap gap in a BL-1458 runner") -
wrapping the runner's body in `try/finally`. That commit landed on
`origin/main` through the BL-1666 land push (per the adjudication's own
account of the entanglement), so this worktree's `git merge main`
already carries it: `48476322ab` is an ancestor of this HEAD, and
`git diff 48476322ab -- swarmforge/scripts/test/bl1458_instruct_documenter_briefing_test_runner.bb`
is empty - the fix is already present, byte-identical.

No further edit is needed; this commit is the BL-1458-attributed
lineage anchor the ruling asks for, plus the re-verification.

## Verification (fresh, this pass)

- `npx vitest run test/tempDirTrapGuard.test.js`: 4/4 pass (D1 confirmed
  fixed - the guard that failed in QA's bounce is now clean).
- `bb swarmforge/scripts/test/bl1458_instruct_documenter_briefing_test_runner.bb`:
  ALL PASS (6/6).
- `bb swarmforge/scripts/test/briefing_generation_schedule_test_runner.bb`:
  ALL PASS.
- `bash swarmforge/scripts/test/test_handoffd_briefing_generation_wiring.sh`:
  4/4 PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1458's feature: 6/6
  (including scenario 06).
- `grep -rn "compose today's briefing per your role" extension/src swarmforge/scripts`:
  empty.
- `npm run compile`: clean.
- `npx vitest run --config vitest.properties.config.mjs test/bl1458BriefingTriggerInvariants.property.test.js`:
  4/4 pass.
- `npx vitest run test/briefingScheduler.test.js`: 11/11 pass.
