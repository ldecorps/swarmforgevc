# BL-1399 amendment (2b) — landed as a follow-up, 2026-09-04

The coder's spec-amendment adoption (`01d04e31e3`) and the hardener's
re-verification (`71711272be`, "superseding earlier forward 2ecdd6341e")
never reached `origin/main` in the original BL-1399 land (`7b3d2108fc`):
the hardener's `git_handoff` for `71711272be` landed in
`.swarmforge/handoffs/inbox/abandoned/00_20260904T203850Z_001139_from_hardender_to_QA_for_QA.handoff`
— apparently dropped by duplicate/no-op detection against the BL-1399 task
name already in flight through this QA session at the time. The coder
caught the gap independently and sent a follow-up `note`:
"BL-1399 landed without amendment 2b; coder 01d04e31e3 has the two
checks."

Verified: `71711272be` was already an ancestor of the QA worktree HEAD (it
arrived via a later merge, `4df546c367`/BL-1388's hardener merge chain),
but its two files (`bl1399FreshnessFixtureOwnRegistrySteps.js`,
`test_bl1399_freshness_fixture_own_registry.sh`) and their evidence had
never been replayed onto `origin/main` by any of the earlier tip-pure
lands (BL-1399, BL-1395, BL-1398, BL-1388), since each of those only
replayed its own ticket's attributed paths. Hand-built and landed as
`0acb71adc5` (own paths only, e2e 8/8 and acceptance 3/3 re-verified on
the tip-pure branch before push). No `abandoned_commits` change needed —
`71711272be`/`01d04e31e3` are now genuinely landed content, not
superseded.

**Process note for the constitution/handoff-protocol owners**: a
`git_handoff` landing in `inbox/abandoned` while its cited commit is real,
approved work is a silent-drop risk — nothing else re-surfaces it except
the sender noticing independently. Worth a defect ticket if this recurs
(same shape as the BL-1052/53 "supersede note missed in-flight forwarded
copies" class already in memory).

By QA.
