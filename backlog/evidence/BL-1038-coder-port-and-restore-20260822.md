# BL-1038 — coder pass, 2026-08-22 (port onto the live line + scenario-07 restore)

## What this parcel found first: the delivered work was not on the live line

Re-dispatched to the coder as if fresh. Before writing anything, checked what
already existed (the ticket's own `notes:` say the work was delivered at
`6c62a65495` and that nothing needs rebuilding). Result:

| ref | `liveRepoDerivationGuard.js` | `bl1038UnitTestsPinTheRepoSteps.js` |
|---|---|---|
| `main` | absent | absent |
| `origin/main` | absent | absent |
| `swarmforge-coder` (live coder branch, per `roles.tsv`) | absent | absent |
| `origin/cutover/wsl-2026-08-22-coder` | **present** | **present** |

The whole of BL-1038's implementation sat on the `origin/cutover/wsl-2026-08-22-*`
snapshot branches and had reached neither `main` nor the live line. The live
branch set is the `swarmforge-*` family (`.swarmforge/roles.tsv`); the cutover
branches are remote-only. Divergence point `82180f665` (12:26:41).

Redoing the work would have duplicated ~13 commits and conflicted with the
snapshot; merging a cutover branch would have pulled in BL-1039/BL-1032/BL-1041
work this approval does not cover (BL-506). So this parcel ports **BL-1038's own
three commits and nothing else**:

    6c62a6549  fixtures copy a dependency closure, not the whole live scripts directory
    81f79d5f0  scenario 07 - a file doing BOTH is flagged only for its live read
    7f4fe8871  restore scenario 07 to the live feature and delete its draft

One conflict, in `specs/pipeline/steps/index.js`: BL-1048's registration (landed
on this line minutes earlier) against BL-1038's. Both belong; both kept.

## Scenario 07 — the one item the specifier left open

The `notes:` correction assigns exactly one thing to whoever holds the parcel:
re-add scenario 07 to the live feature and delete the `.feature.draft` in the
same commit (BL-233). Carried by `7f4fe8871`, now on this line:

- `specs/features/BL-1038-...feature` — **7 scenarios** (was 6)
- `specs/features/BL-1038-...feature.draft` — **deleted**
- handlers for all three of its steps present in `bl1038UnitTestsPinTheRepoSteps.js`

Scenario and handlers now land together, which is what BL-233 asks for.

## Verification

- Acceptance `BL-1038-unit-tests-pin-the-repo-they-derive-from.feature` — **8 pass / 0 fail**.
- `liveRepoDerivationGuard.test.js` 11, `pinnedRepoFixture.test.js` 7 — all pass.
- The six converted files — `commitIntegrityRunner`, `epicMakeTopBridge`,
  `epicReorderBridge`, `pausedPagerBridge`, `telegramFrontDeskBotCli`,
  `topicMakeTopBridge` — **368 tests, all pass**, ~10s of summed work, slowest
  file 3.1s.
- Property lane: `bl1038PinnedFixture` (2), `bl892ApprovalCommitDurability` (2),
  `bl687EpicTileSurfaceUntouched` (1) — all pass.
- **The guard is armed and green on the real tree**: `findLiveRepoDerivations`
  over `extension/test` reports **0 violations**. It is a real gate, not a
  fixture-only check — driven over the live directory by both
  `liveRepoDerivationGuard.test.js:119` and `bl1038UnitTestsPinTheRepoSteps.js:161`.

## Measured — the ticket's own subject

Full unit lane on this line, this host:

    465 files, 8231 tests, 21.1s wall
    suite file budget OK: 465 files, all within 7.0s

BL-378's per-file 7s budget, which the ticket records as having **19 live
offenders** and therefore failing every run, now passes with **zero**.

Invariant 3 (speed never bought with coverage): `.test-durations.jsonl`
`test_count` **596 → 599** — it rose. No test deleted, none skipped, no exclude
glob widened; the port adds test files only.

The 10.0s SUITE_DURATION_BUDGET_MS is still exceeded (21.6s). Untouched
deliberately — this ticket does not reprice budgets; BL-1007 owns load-relative
budgets and BL-999 budget justification.

## Two red files, both PRE-EXISTING and owned elsewhere — not this parcel

    tempDirTrapGuard.test.js  -> swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb
                                 "creates a temp root but has no shutdown hook and no try/finally delete-tree"
    tmuxReaperGuard.test.js   -> specs/pipeline/steps/bl1018SingleRoleRepairNeverKillsServerSteps.js
                                 "starts a tmux server ('new-session') but does not require ./lib/fixtureReaper and call track()"

Neither file is touched by this parcel. Their last-touching commits are
`71ee902a2` (BL-1025 D1 re-fix) and `3e15acabc` (BL-1018), and **both are
ancestors of `main` AND `origin/main`** — so both guards are red on `main`
itself, independently of this line. They arrived here with the payload merge.
Surfaced, not swept, and not folded in (BL-506).

## Residual this parcel does NOT close — worth a ruling, stated honestly

Invariant 1 says no unit-lane test's cost is a function of the live repository's
size or history depth. The guard enforces that for growth operations that
*statically target the bound live root by name* — its header records four
attempted boundaries and why three were rejected.

Rejected placement #2 was "root bound and handed to production code ... code
given a root may read one file or a thousand, and no static pattern separates
them." That is exactly what `renderBriefingBurndownCli.test.js` does:

    const repoRoot = path.join(__dirname, '..', '..');
    const diagrams = renderBriefingBurndown(repoRoot);   // runs git log inside

So the ticket's four headline live-repo readers — `renderBriefingDiagramsCli`
(51.8s), `renderBriefingBurndownCli` (34.0s), `briefingDigestLineCli` (10.1s),
`emitLifecycleSnapshotCli` (4.0s), ~99.9s on the profiled host — are **neither
converted nor exempted**, and the guard cannot see them by construction. On this
host they are all inside the 7s per-file budget, so nothing is red; on the
1-fork macOS host of the original profile they are the bulk of the cost.

Not rebuilt here, and deliberately not bounced: the specifier ruled twice that
the delivered commit satisfies the amendment ("Do not rebuild anything against
the amendment"), and the amendment's own converted-file list — all six shared
files — is fully satisfied. Recording it so the gap is a decision rather than an
oversight; it likely deserves its own slice on epic `unit-suite-speed`.
