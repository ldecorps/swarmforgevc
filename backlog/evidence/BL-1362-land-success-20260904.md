# BL-1362 — LAND SUCCESS, 2026-09-04

A review pass now records its Article 4.4 evidence commit through a tool
(`record-review-evidence.ts`) rather than every role hand-deriving the
filename, structure, and forward commit.

## Verification

- `npm run compile` — clean.
- `npx vitest run` on all four unit test files — 33/33.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1362ReviewEvidenceByToolInvariants.property.test.js` — 2/2.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1362's feature — 9/9.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- No `bounce_history`.
- CRAP/coverage independently re-run (`extension/src` touched, three new
  files): `npx vitest run --coverage --coverage.reportOnFailure=true` +
  `node scripts/crapReport.js` — zero functions over the CRAP-6 threshold
  in any of the three new files. Confirms hardener's own real finding-and-
  fix (a 156.70 CRAP gap in the CLI argv parser, closed by extracting
  `parseItemFlag`/`collectFlags`/`applyFlag`) actually landed clean, not
  just claimed.
- DRY (`npx jscpd --config .jscpd.json src`) — 75 pre-existing clones
  repo-wide, none touching the three new files.

## Hand-built tip-pure commit — refused FOUR times by a live, severe host
incident (unrelated to this ticket)

Built in scratch worktree `/tmp/land-bl1362`, off `origin/main` at
`ac3e16a4df` (the tip left by this session's BL-1358 land). Own-paths (17
files) from the coder/cleaner/architect/hardener/documenter evidence
trail, cross-checked against `git diff --name-only origin/main <QA-tip
62f20f7390>` — clean, no foreign-ticket content.

While committing, `check_property_suite_drift.sh` correctly refused four
times in a row, each citing different non-allowlisted failing files, with
run durations climbing (332s → 570s). Investigated rather than blindly
retrying after the second identical-pair repeat: `uptime` showed load
average 8.72+ climbing to 11+, `free -h` showed 1.5GB swap in use, and

```
pgrep -fa "test_bl1390_post_commit_push.sh" | grep -c "^[0-9]* bash swarmforge/scripts/test/test_bl1390_post_commit_push.sh$"
1156
```

— BL-1390's own e2e test (unrelated to BL-1362, running concurrently in
the coder worktree) had exploded to over a thousand concurrent copies of
itself, consuming enough host CPU/RAM to explain the property-suite
timeouts system-wide. Full account and root-cause read:
`backlog/evidence/QA-bl1390-runaway-test-process-explosion-20260904.md`
(committed separately, escalated to specifier + coordinator by priority
`00` note — not fixed here, not my ticket).

Waited for the runaway to clear (confirmed 0 copies, load and swap
dropping) rather than force a commit through instability. Every flagged
file re-ran clean in isolation on every attempt but one
(`bl1367ApprovalCarriesItsRuling`, code BL-1362 does not touch — failed
once with a genuine assertion error under residual load, then passed
clean twice more immediately after). Fifth attempt, post-clearance,
committed clean.

## Re-verified on the tip-pure tree (before the commit that stuck)

- `npm run compile` — clean.
- `npx vitest run` on all four unit files — 33/33.
- `npx vitest run --config vitest.properties.config.mjs` on the property
  file — 2/2.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1362's feature — 9/9.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `git diff --diff-filter=D origin/main --cached` — empty.

## Landed

- Tip-pure commit `0dab987fac` off `origin/main` at `485fd43bce`.
  `land_main_publish.sh --decide-only` read `:next :push`,
  `origin-advanced-since-gate: false`. Pushed `485fd43bce..0dab987fac`.
  Verified with `git ls-remote origin main` before releasing the lock
  (per this session's own earlier lesson: the wrapping publish step does
  not itself verify a push succeeded).
- No `abandoned_commits` follow-up: no automated `land_step_cli.bb`
  attempt was run for this ticket (hand-built directly).
- Scratch worktree `/tmp/land-bl1362` removed after confirmed push.

## Not a GH-seeded ticket

`BL-1362`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
