# BL-1363 — LAND SUCCESS, 2026-09-04

Closing a ticket becomes a single command (`close_ticket.sh`) through the
same integrity path promotion already uses.

## Verification

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1363_close_ticket.sh` — 19/19,
  including its own regression check that the live repository's origin
  URL is byte-identical after the suite runs — this team proactively built
  the same protection this session's BL-1390 incidents required (bounced
  there for having missed exactly that scenario's implementation).
- `bash swarmforge/scripts/test/bl1363_close_ticket_property_runner.sh` —
  ALL PROPERTIES HOLD (12 constructed cells).
- `bash swarmforge/scripts/test/bl1363_close_ticket_mutation_sweep.sh` —
  6/6 killed, 0 survived, 0 skipped.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1363's feature — 5/5,
  matching the feature file's own 5 `Scenario:` count exactly (checked
  explicitly this pass, after this session's BL-1390 lesson that a
  passing-but-short acceptance count can hide a missing step handler).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- No `bounce_history`. No `extension/src` touched — CRAP/DRY N/A.
- Human ruling followed: new closes settle into milestone directories; the
  existing 665 loose `backlog/done/` files are left alone (verified: no
  migration code, `close_ticket.sh` only decides the destination for the
  ticket it is given).
- No orphaned test/mutation processes in this worktree before or after.

## Hand-built tip-pure commit — carrying unrelated BL-1390 content required exclusion

Built in scratch worktree `/tmp/land-bl1363`, off `origin/main` at
`0dab987fac` (the tip left by this session's BL-1362 land). Own-paths (14
files) from the coder/cleaner/architect/hardener/documenter evidence
trail, cross-checked against `git diff --name-only origin/main <QA-tip
5b8c8c2ff8>`.

That raw diff also carried substantial BL-1390 content (its post-commit
hook, `push_sweep_lib.bb`/`post_commit_push.bb`/`handoffd.bb` changes, the
engineering-guardrail prompt edits, its own how-to page, feature file, and
step handler) — expected, since BL-1390 is still bounced this session
(`backlog/evidence/BL-1390-bounce-20260904.md`) and both tickets moved
through the same shared documenter worktree. Verified each ambiguous file
individually before excluding (grepped for `BL-1390`/`BL-1363` mentions in
each diff; confirmed `push_sweep_lib.bb`, `handoffd.bb`,
`push_sweep_lib_test_runner.bb`, both engineering prompt articles, and
`docs/index.md`'s new line are 100% BL-1390 content, none touching
BL-1363). `docs/index.md` needed NO change for BL-1363 at all (confirmed
against the documenter's own evidence: "no dedicated page", Specification.MD
entry only). `swarmforge/scripts/test/suite-manifest.tsv` needed a
one-line splice (kept BL-1363's own row, dropped BL-1390's row it also
carried) — matched the file's existing tab/trailing-whitespace format via
`cat -A` before appending.

Also excluded BL-1391/BL-1392/BL-1393 — separate, unrelated, unlanded
tickets whose topic/paused/feature files rode the same shared worktree
merge.

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1363_close_ticket.sh` — 19/19.
- `bash swarmforge/scripts/test/bl1363_close_ticket_property_runner.sh` —
  ALL PROPERTIES HOLD.
- `bash swarmforge/scripts/test/bl1363_close_ticket_mutation_sweep.sh` —
  6/6 killed.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1363's feature — 5/5.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `git diff --diff-filter=D origin/main --cached` — only
  `backlog/paused/BL-1363-...yaml` (the ticket's own stale pre-promotion
  copy — legitimate, expected).

## Landed

- Tip-pure commit `d39445aba1` off `origin/main` at `0dab987fac`.
  `land_main_publish.sh --decide-only` read `:next :push`,
  `origin-advanced-since-gate: false`. Pushed `0dab987fac..d39445aba1`.
  Verified with `git ls-remote origin main` before releasing the lock.
- No `abandoned_commits` follow-up: no automated `land_step_cli.bb`
  attempt was run for this ticket (hand-built directly, expecting the
  same BL-1390-contamination pattern the raw diff already showed).
- Scratch worktree `/tmp/land-bl1363` removed after confirmed push.

## Not a GH-seeded ticket

`BL-1363`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
