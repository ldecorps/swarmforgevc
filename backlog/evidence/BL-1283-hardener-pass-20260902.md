# BL-1283 — hardener pass, 2026-09-02

Reviewed commit `abbf9cc44f` (architect clean sweep), merged into hardender.
Review-only BL-848 stamp-off parcel for landed hotfix `2b67f4b1a2`: no
hotfix source touched by this parcel's own commits (coder/cleaner/architect)
— only the acceptance step handler
`bl1283PipelineBoardSleepFreezeSwarmStampSteps.js` and its `index.js`
registration.

## Load / process hygiene
- Same session as BL-1319, processed in the same batch pass; load quiet
  throughout (0.86-3.6 on 20 cores).
- `pgrep -fl 'node --test|stryker'`: no strays before starting.

## Checks run (independent re-run)
- `git log aefa5f0fe4..HEAD -- extension/src/concierge/conciergeTick.ts
  extension/src/tools/telegram-front-desk-bot.ts
  swarmforge/scripts/property_suite_standing_allowlist.tsv` — empty:
  confirmed no hotfix source touched by this ticket's chain, matching
  architect's evidence.
- `npx vitest run test/conciergeTick.test.js` — 121/121 pass (run together
  with BL-1319's test files in the same combined batch pass).
- `node specs/pipeline/cli.js
  specs/features/BL-1283-swarm-stamp-pipeline-board-sleep-freeze-2b67f4b1a2.feature`
  — 8/8 pass, including scenario 05 (liveness-probe failure-direction),
  scenario 06 (allowlist-attribution finding), and scenario 07 (ledger row
  unmodified).
- `grep -A5 2b67f4b1a2 backlog/hotfix-ledger.yaml` — row still reads
  `state: stamp-open`, `human_decision: null`. Not written by this pass.

## Mutation / CRAP / DRY
Babashka has no mutation/CRAP/DRY wired (BL-472, deferred) and no hotfix
`.bb`/`.ts` source is touched by this review-only parcel — nothing to
mutation-test or measure. This is the documented degraded-fallback case
(no tooling applies because there is no touched production code, not
because the tool is unavailable), recorded explicitly rather than implied.
The one JS file this parcel's chain adds
(`bl1283PipelineBoardSleepFreezeSwarmStampSteps.js`) is an acceptance step
handler asserting against already-landed, already-tested production code
(`conciergeTick.ts`'s 121-test suite covers the actual behavior) — mutating
the step handler itself would test the review apparatus, not the hotfix.

## Invariants (independently re-checked)
1. Never reimplements the hotfix — `git diff` confirms no hotfix source
   touched by this parcel.
2. Green never certifies — ledger row unmodified, confirmed above.
3. A frozen board is the previous board unchanged — scenario 01's
   acceptance assertion (zero board/pin calls while asleep) passes.

## Finding review (scenario 06 / qa_e2e item 5) — unchanged from architect
The coder's finding (the two `property_suite_standing_allowlist.tsv` rows
cite a closed, non-covering ticket BL-1175) is reported mechanically by the
step handler, not acted on — correct per the ticket's `constraints`, which
explicitly forbid removing or re-attributing those rows in this parcel.
Re-confirmed: `grep -A2 bl874PortableTimeInvariants
swarmforge/scripts/property_suite_standing_allowlist.tsv` and the same for
`tempDirTrapGuard` both cite BL-1175, and `backlog/done/` holds BL-1175 as
closed with no text naming either file — matches the finding.

## Whole-tree acceptance guard sweep
Same combined sweep as BL-1319 (parcel touches `specs/pipeline/steps/`):
the same 3 pre-existing failures (BL-1289/1290/1291), none naming any
BL-1283 file.

## Lessons
No new `rule_proposal` for this ticket specifically — see BL-1319's
evidence file (same batch pass) for the Stryker-sandbox-blocked finding,
which does not apply here since no production TS/bb source was touched.

## Verdict
Clean sweep — no defect found. Forwarding to documenter.
