# BL-1367 — LAND SUCCESS, 2026-09-04

Resumed via specifier `note` (priority `00`, 13:33Z): "BL-1386: hand-build
tip-pure per BL-1376, then land BL-1367; adj 7d8c4549c4" — route 2 of
`backlog/evidence/BL-1386-land-escalate-adjudication-20260904.md`.

## Context: a concurrent, unrelated re-promotion

While processing this note, found `cf08ad011d` ("Promote BL-1367: paused →
active for coder") on `main`, timestamped ~16 minutes AFTER the specifier's
note — a separate, apparently uninformed action re-cycling this ticket as
fresh unclaimed work. Not acted on: the ticket's own content is unchanged
(`human_approval: approved`, no `bounce_history`, `required_wiring` already
in the post-BL-1371 anchor shape) and its 2026-09-03 QA pass
(`backlog/evidence/BL-1367-qa-pass-20260903.md`) stands. Landing the
already-approved work resolves the promotion as moot; not correcting it
directly.

## Re-verification (time had passed since the 09-03 pass)

- `npm run compile` — clean.
- `npx vitest run test/pendingApprovalReply.test.js test/pausedPagerBridge.test.js`
  — 109/109 pass.
- `npx vitest run --config vitest.properties.config.mjs test/bl1367ApprovalCarriesItsRuling.property.test.js`
  — 2/2 pass.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1367's feature — 4/4.
- `required_wiring` both confirmed live: `computePausedPagerApproveOutcome`
  (`bridgeServer.ts:861`), `bl1367ApprovalCarriesItsRulingSteps::registerSteps`
  (line 59/125).
- Live sweep (qa_e2e_procedure step 5, re-run): every `backlog/active/*.yaml`
  and `backlog/paused/*.yaml` for `ruling_options:` + `human_approval:
  approved` + no `human_ruling:` — empty set. Invariant 1 holds against the
  live backlog, not only the fixture.
- `bounce_history`: none.

## Hand-built tip-pure commit

`land_step_cli.bb` was not re-run for this ticket specifically — its own
09-03 attempt (`backlog/evidence/BL-1367-land-escalate-20260903.md`) already
diagnosed the retired shared-registry class, and BL-1386/BL-1387/BL-1381/
BL-1379's escalations this session confirm the automated tool still reads
the same inflated sibling list. Hand-built directly, per QA.prompt step 4
(same class already adjudicated, no new escalation needed).

Built in scratch worktree `/tmp/land-bl1367`, off `origin/main` at
`108517e9f7`. Own-paths (13 files) from the coder/cleaner/architect/
documenter evidence trail (`backlog/evidence/BL-1367-{coder,cleaner,
architect-pass,documenter,qa-pass,land-escalate}-20260903.md`), cross-
checked against `git diff --name-only origin/main <QA-tip 3ff32a5909>`
restricted to BL-1367-owned paths — confirmed `bridgeServer.ts` and
`pendingApprovalReply.ts`'s diffs against `origin/main` were exclusively
BL-1367 content (read the diff hunks directly, no interleaving with another
ticket). `docs/index.md` and `docs/reference/Specification.MD` line-spliced
(both shared, append-only) — `Specification.MD`'s entry inserted at its
correct chronological position in the "Prior entry —" stack (immediately
after BL-1371's entry, matching this worktree's own stack order), not
appended at the top.

**No ticket-yaml move.** BL-1367's own `backlog/paused/...yaml` was left
untouched in this land (same posture as BL-1386/1387/1381/1379's earlier
lands this session) — Article 3.3 backlog bookkeeping is the coordinator's,
notified below.

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `npx vitest run test/pendingApprovalReply.test.js test/pausedPagerBridge.test.js`
  — 109/109.
- `npx vitest run --config vitest.properties.config.mjs test/bl1367ApprovalCarriesItsRuling.property.test.js`
  — 2/2.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1367's feature — 4/4.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `git diff --diff-filter=D origin/main --cached` — empty.

## Landed

- Tip-pure commit `9e6170fb06` off `origin/main` at `108517e9f7`.
  `land_main_publish.sh --decide-only` read `:next :push`,
  `origin-advanced-since-gate: false`. Pushed `108517e9f7..9e6170fb06`.
- No `abandoned_commits` follow-up: no automated replay branch/commit was
  ever produced for this ticket (both 09-03 attempts `LAND_ESCALATE`d
  before building one).
- Push went through `land_main_publish.sh --acquire-lock` / `--decide-only`
  / `--release-lock` (BL-1144 discipline).
- Scratch worktree `/tmp/land-bl1367` removed after push.

## Not a GH-seeded ticket

`BL-1367`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
