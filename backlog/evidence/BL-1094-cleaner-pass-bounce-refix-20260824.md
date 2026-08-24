# BL-1094 cleaner pass (QA bounce re-fix) — 2026-08-24

## Inbound

Merged coder commit `a1a2feb5b3` (strip uncertified hitchhikers that
regressed BL-1113 stamp-off) into `swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor a1a2feb5b3 HEAD`.

Prior QA bounce (`backlog/evidence/BL-1094-qa-bounce-20260824.md`): D1–D3
all blamed **coder** (cursor-forge.conf window count, pipelineBoard
`&#160;` vs `&nbsp;`, HOTFIX_PATHS blob drift). No cleaner-blamed items to
clear.

## Bounce clearance (content)

| Item | Check | Result |
|---|---|---|
| D1 | `cursor-forge.conf` blob == `27273f2b0a`; acceptance pack scenario | OK / green |
| D2 | `pipelineBoard.ts` blob == `27273f2b0a`; BL-1113 board Outline | OK / green |
| D3 | HOTFIX_PATHS property + blob identity | OK / green |
| hitchhiker overlay | `swarmforge/packs/cursor-forge.prompt` removed | OK |

## Checks run

1. `npm run compile` (extension/) — clean.
2. `npx vitest run test/pipelineBoard.test.js` — 127/127.
3. `bb swarmforge/scripts/test/task_commit_coherence_gate_lib_test_runner.bb` — ALL PASS.
4. BL-1094 acceptance — 5/5.
5. BL-1113 acceptance — 9/9.
6. `bl1113CursorHotfixStampOff.property.test.js` — pass (D3 lock).

CRAP/mutation/DRY tooling not wired for `.bb`; TS surface only restored to
already-stamped blobs — no new production structure to CRAP. Mutation-site
count N/A for a restore-to-stamp tip.

## Cleanup review

NONE beyond verification. Coder's re-fix is a pure restore of stamped
blobs + deletion of the hitchhiker-only overlay; no DRY/structure debt
introduced. Prior cleaner classifier split (`28f253d156`) remains in lineage.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it`.

By cleaner.
