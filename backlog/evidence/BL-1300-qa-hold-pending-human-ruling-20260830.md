# BL-1300 — QA verification complete (green); landing held on a pending human_ruling

## Verdict

Implementation verified CORRECT and fully green for **option 1** (pin the
`BL-1227` fix-commit `Given` to a recorded tree; keep 44000 as the single
enforceable budget). **Not landed** — see "Why held" below. This is not a
bounce: no defect was found in the coder's work.

## What was verified

- Commit lineage: merged `coder`'s two commits
  (`9553cf9354` the fix, `3fe063d3ad` self-audit corrections) into
  `swarmforge-QA`. `required_stages: [coder, qa]` routing (BL-606, config
  `required_stages_routing_enabled true`) legitimately skipped
  cleaner/architect/hardener/documenter per the ticket's own
  `stage_skip_reasons` — QA itself was not skipped, so the routing is valid.
- Targeted unit tests: `extension/test/bl1300HeadroomProofIsPinned.test.js`
  4/4 pass.
- Property test: `extension/test/bl1300SingleEnforceableBudget.property.test.js`
  2/2 pass (declared invariant: "Exactly one number is enforceable as the
  boot-prefix budget, and it is the number the failing report names").
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1227-boot-prefix-live-budget-check.feature` → 7/7 pass.
- Whole unit suite (`npm test`, extension/): 566/582 files, 9780/9806 tests
  green. 26 failing files are pre-existing, unrelated to any BL-1300 path —
  grepped against `backlog/{active,paused,hold}` and traced to open tickets
  (mostly BL-1229 `deps.checkOrphanedAuthoredDocs is not a function`, plus
  BL-1291/BL-1290/BL-1289/BL-1265/BL-1294/BL-1303/BL-1221/BL-1226/BL-564/
  BL-725/BL-842/BL-841/BL-1263/BL-1206/BL-1212). None touch
  `specs/pipeline/steps/bl1227BootPrefixLiveBudgetCheckSteps.js` or the two
  new `bl1300*` test files.
- Property suite (`npm run test:properties`, extension/): 266/292 files,
  818/833 tests green (plus one BL-871-allowlisted
  `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error). BL-1300's
  own property file passed. The 26 failing files are pre-existing debt,
  mostly traced to open ticket BL-1206 (`require('node:test')` breaks Vitest
  property collection → "No test suite found in file") and BL-1229. A
  residual 9 files (bl1012, bl1113, bl1115, bl1116, bl1117, bl1136, bl1200,
  bl604, bl632 — each an ALREADY-SHIPPED ticket's own regression test, not
  BL-1300's) have no open incident ticket; reporting untracked to specifier
  separately (not a BL-1300 concern; none touch BL-1300's paths).
- Wiring: `lib/lazy`, `lib/fixtureReaper` (`onAbnormalExit`) both exist and
  are correctly used; the step handler was already registered pre-existing,
  unchanged registration path.
- BL-1241 entangled-tip remedy: `land_step_cli.bb` LAND_REPLAY, entangled
  siblings BL-1288/BL-1295/BL-1299 (all already independently confirmed as
  ancestors of `origin/main` or landed-as-passenger; none are live
  concerns). Tip-pure replay built at `land-replay/BL-1300-4cdb93323b` →
  `46a132c6d4b9611f6932215a2b7cf17e45d82c79`, content verified byte-identical
  to the reviewed worktree files. **Caught and corrected during review**:
  the FIRST replay attempt (before syncing `origin/main` into the QA branch)
  spuriously included a reversion of BL-1305's already-landed
  `human_approval: approved → pending` — a real regression of a separate
  ticket's live approval, not a legitimate part of BL-1300's own diff.
  Merging `origin/main` into `swarmforge-QA` first (new HEAD `4cdb93323b`)
  resolved the staleness and the re-run replay no longer carries it — only
  benign, purely-additive `abandoned_commits` self-documentation on
  BL-1288/BL-1299 (both already-landed tickets) remains as incidental
  content.

## Why held — not landed

While reviewing, `git fetch origin main` picked up
`fa44ad1619` ("BL-1300: declare ruling_options so the approval ask can
carry the choice", by specifier, landed 23:17:01, i.e. **after** both of
coder's implementation commits and **after** coder's own 22:13:12Z spec-gap
note about the same gap). It records:

- The original 19:37 BST Approve tap stands as approval of the *existence*
  of the defect/fix, but could not carry *which shape* to build (no
  `ruling_options` declared at the time → BL-589 plain-keyboard gap → no
  `human_ruling` recorded).
- `human_approval` was deliberately reset to `pending` with `ruling_options`
  now declared (option 1 / option 2), explicitly **not** an erased approval
  — a fresh, ruling-carrying tap is required before restoring `approved`.
- Re-checked against latest `origin/main` (`58e69ac650`) immediately before
  writing this evidence: still `human_approval: pending`, no `human_ruling`
  recorded.

The coder built option 1, which is a fully valid, well-executed resolution
— but there is currently no recorded human ruling selecting option 1 over
option 2, and the two options are NOT equivalent in scope (option 2 also
requires the documenter stage, which this parcel's `required_stages`
correctly excludes only under option 1). Landing now would ship a specific
design choice the human has not yet been asked to confirm under the corrected
ask. This is a live specifier-owned gate (Article amendment in-flight,
"Amending An In-Flight Ticket's Spec"), not a coder defect — no bounce.

## Disposition

Parcel held at QA, **in_process, not bounced, not landed** — mirrors the
BL-1295 precedent (QA-verified clean, parked at QA pending an external
condition). The tip-pure replay branch `land-replay/BL-1300-4cdb93323b`
(commit `46a132c6d4b9611f6932215a2b7cf17e45d82c79`) is ready to land as soon
as `human_ruling: option 1` is recorded — left in place rather than
discarded, so landing does not require rebuilding the replay.

Notified: specifier + coordinator via `note` (priority `00`).
