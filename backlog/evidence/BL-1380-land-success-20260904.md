# BL-1380 — LAND SUCCESS, 2026-09-04

The paused-pager Expedite route's twin of BL-1367's Approve-route fix, per
the human ruling: refuse with 409 naming the gate and options rather than
writing a bare approval and discarding the choice.

## Verification

- `npm run compile` — clean.
- `npx vitest run test/pausedPagerBridge.test.js` — 25/25.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1380ExpediteNeverAnswersUnshownQuestion.property.test.js` — 2/2,
  both declared properties (P1+P2 refusal-with-nothing-written, P3
  no-choice-left expedites unchanged).
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1380's feature — 6/6.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- No `required_wiring` declared (modifies a pre-existing route, same shape
  as BL-1367).
- No `bounce_history`.
- Human ruling conformance verified directly: `409` present at the two new
  call sites in `bridgeServer.ts` implementing
  `classifyExpediteRulingRefusal`/`handlePausedPagerExpediteRoute`.
- CRAP independently re-run (`extension/src` touched, not N/A):
  `npx vitest run --coverage --coverage.reportOnFailure=true` (the
  documented workaround for the ~16 pre-existing unrelated reds that
  otherwise leave `coverage-final.json` unwritten), then
  `node scripts/crapReport.js`. Both touched/new functions score clean —
  `classifyExpediteRulingRefusal` CRAP 2.00, `handlePausedPagerExpediteRoute`
  CRAP 2.00 — matching hardener's own evidence exactly. The file's other
  high-CRAP entries (`bridgeServer.ts`'s pre-existing dispatcher debt) are
  unchanged noise from functions this ticket never touched.
- No orphaned test/mutation processes in this worktree (concurrent
  `node --test` processes seen under `.worktrees/coder` belong to that
  role's own session).

## A repair carried along: BL-1389's own how-to omission, fixed here

Building this land's own-paths, `docs/how-to/BL-1241-entangled-tip-at-the-land-step-has-a-reachable-remedy.md`
showed a real diff against `origin/main` — but BL-1380 does not touch that
page. Investigated: it is this session's own earlier BL-1389 land's
omission — that file WAS in BL-1389's merge diff (a new "per-path-complete"
section) but was left out of BL-1389's own-paths `FILES` list by copy
mistake, so the section never reached `origin/main`. Since BL-1380
genuinely does extend the NEIGHBOURING how-to page
(`docs/how-to/BL-1367-approval-from-any-surface-carries-its-ruling.md`,
with a new "A third surface" section) and both pages are conceptually
paired, carried BL-1241's full current (QA-worktree) content along in this
same land rather than leaving the gap open for a future land to
rediscover. Confirmed content already correct/reviewed (BL-1389's
hardener/documenter both signed off on it).

## Hand-built tip-pure commit, direct to hand-build this time

Built in scratch worktree `/tmp/land-bl1380`, off `origin/main` at
`980129761c` (the tip left by concurrent specifier/coordinator activity —
BL-1390/1391 minting and BL-1389's own close-to-done bookkeeping — since
this session's BL-1389 land). Own-paths (15 files) from the
coder/cleaner/architect/hardener/documenter evidence trail, cross-checked
against `git diff --name-only origin/main <QA-tip c467892ca1>` — clean,
no foreign-ticket content (both BL-1367 and BL-1389 already landed, so
neither's files rode this time).

Skipped `land_step_cli.bb` entirely this pass rather than running it first
— every automated attempt this session has either escalated on the known
27-sibling inflation or, post-BL-1389, hit the separate known merge-tip
first-parent-attribution gap; going straight to the hand-build recipe
saved a ~2-3 minute round trip for no informational gain.

## Landed

- Tip-pure commit `c0e502ebd6` off `origin/main` at `980129761c`.
  `land_main_publish.sh --decide-only` read `:next :push`,
  `origin-advanced-since-gate: false`. Pushed `980129761c..c0e502ebd6`.
- No `abandoned_commits` follow-up: `land_step_cli.bb` was not run for
  this land (see above), so no automated replay commit exists to record.
- Push went through `land_main_publish.sh --acquire-lock` /
  `--decide-only` / `--release-lock` (BL-1144 discipline).
- Scratch worktree `/tmp/land-bl1380` removed after push (a stray
  best-effort `land_step_cli.bb` probe launched just before removal raced
  it and failed harmlessly — "Cannot resolve repo root" — no replay was
  produced either way).

## Not a GH-seeded ticket

`BL-1380`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
