# BL-1356 — LAND SUCCESS, 2026-09-04

Seventh land this session/turn, second resumed via a coordinator note
pointing at an already-approved commit (same shape as BL-1359, sharing the
same two named blockers). Re-verification is in
`BL-1356-qa-relanding-20260904.md`, written before this land attempt.

## Fetched and merged fresh `origin/main` BEFORE attempting the land this
time — avoided BL-1359's stale-comparison false negative

Learned from BL-1359's own land this session: fetched `origin/main` and
merged it into this worktree first (clean — BL-1359 itself had, in the
interim, been closed to `backlog/done/` by the coordinator, plus BL-1385
promoted paused → active). `land_step_cli.bb` then returned `LAND_REPLAY`
directly on the first attempt.

## Same standing over-inclusion class

Automated replay's diff against `origin/main` included, beyond BL-1356's
own 18 files: two other tickets' own `backlog/done/*.yaml`, one unrelated
INTAKE file, one unrelated generated briefing file, a spurious `D
backlog/topics/BL-1385.json` line (an artefact of the automated tool's own
comparison base, not a real deletion — this hand-build never touches that
path since it's built fresh off `origin/main`), and `docs/index.md`/
`Specification.MD` stacking two other tickets' (BL-1367, BL-1360) entries.
`docs/how-to/BL-1175-property-suite-standing-reds-block-unrelated-commits.md`
and `swarmforge/scripts/property_suite_standing_allowlist.tsv` — both
excluded as "not theirs" for every OTHER ticket landed this session — are
genuinely BL-1356's own here; verified each diff's scope directly (the
allowlist diff is a clean 5-row deletion, no other ticket's additions
mixed in) before including them whole.

## Hand-built tip-pure commit

18 whole-file checkouts (7 evidence + the BL-1175 how-to page + the
mutation-sweep script + 5 modified stamp-off test files + 2 new BL-1356
test files + feature-stub extension + the standing allowlist) + 2
line-level splices (`docs/index.md` one line; `docs/reference/
Specification.MD` one 32-line entry, inserted between the just-landed
BL-1359 block and the BL-1337 block, excluding BL-1367/BL-1360 stacked
elsewhere in the automated diff). Built off `origin/main` at `bb865673dd`.
`git diff --cached --stat origin/main`: 20 files, 1348 insertions(+), 148
deletions(-) — every file blob-verified byte-identical to the cited commit
before commit.

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `check_feature_handler_registration.sh <tree> --assume-main` — passed.
- `npx vitest run bl1356StampOffHelper.test.js` — 21/21 pass.
- `npx vitest run --config vitest.properties.config.mjs
  bl1356StampOffInvariants bl1113CursorHotfixStampOff
  bl1115MainSyncStatusCliStampOff bl1116ExtensionWipHotfixStampOff
  bl1117PipelineBoardNumericNbspStampOff
  bl1136BabysitterdCursorForgeStampOff` — 6 files, 11 tests, all pass.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1356-stamp-off-invariant-watches-the-run-not-the-row.feature`
  — 6/6 pass.

## Landed

- Tip-pure commit `df2acdada9` off `origin/main` at `bb865673dd`. Pushed
  `bb865673dd..df2acdada9`.
- Follow-up commit `67e0f0d139`: `abandoned_commits: [20c375a104]`
  recorded on the ticket YAML (first entry). Pushed
  `df2acdada9..67e0f0d139`.
- Neither push carried any `PASSENGER_SIBLING` content.
- Lock acquired/released from the shared root
  (`/home/carillon/swarmforgevc`); both `--decide-only` calls returned a
  clean `:next :push` on the first try — no rematch needed this time
  (origin/main did not advance between the tip-pure commit and the push,
  unlike BL-1359's own land).

By QA.
