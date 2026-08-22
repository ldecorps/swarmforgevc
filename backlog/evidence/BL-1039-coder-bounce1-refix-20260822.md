# BL-1039 — coder, 2026-08-22: architect SEND BACK #1 cleared (D1–D4), on the live line

## Two things had to happen, not one

**(a) The parcel was not on the live line.** Like BL-1038 and BL-1032, BL-1039's
delivered work sat only on `origin/cutover/wsl-2026-08-22-*` and was absent from
`main`, `origin/main` and `swarmforge-coder`. Ported the CODER commit
`888c0a665` (fixture, guard, property test, step handlers, 6 converted files).
The architect's own partial revert `9b960d9f4` — which removed the incomplete
guard and parked the feature as `.feature.draft` — was deliberately NOT ported:
the guard is re-delivered here fixed, so reverting it first and rebuilding it
would be churn. The live feature file is present with all 8 scenarios.

**(b) The bounce had to be cleared.** All four defects below.

## D1 — the guard's blind spot (the reason it went back)

`CREATES_A_REPO` required `'git'` as a quoted STRING argument, so it could not
see the corpus's DOMINANT shape: a local wrapper named `git`, where `git` is a
bare identifier.

    function git(cwd, args) { execFileSync('git', args, { cwd }); }
    git(dir, ['init', '-q']);          // <- invisible to the old regex

Added a fourth alternation keying on the CALL SITE, the same shortcut the inline
case already takes. Reproduced the architect's numbers exactly before fixing:
**inline-only 15, wrapper-only 43, both 1 — 59 total**, against a guard that
reported 16.

`\bgit\(` requires the paren immediately after `git`, so `gitIn(...)` — the
shared fixture helper's own internal spawn, whose whole purpose is to create the
template — is not matched. Widening that would be BL-1032's defect repeated.

## D2 / D3 — the violations themselves

**59 → 0.** 112 call sites across 62 files now take their repository from the
shared fixture. That includes every file D2 named: `drainAnswerFilesCli`,
`pilotAcceptanceGateCli`, the four onboarding CLIs, `runRoleBenchmarkCli`,
`leanLedgerCompose`, `gitHistoryAdapter`, `blTopicStore`, the four outside the
ticket's own table (`config`, `prCreator`, `traceHopCli`/`traceHopMain`,
`workTree`), and `telegramFrontDeskBotCli`'s three unconverted inline calls —
now **0** remaining. D3's `costHealthSidecar.test.js` is converted (13 sites).

### Three exemptions, each recording a repository shape the fixture cannot express

Not rubber stamps — the seeded fixture is a working copy with identity and one
commit by construction, so three shapes are genuinely outside it:

| file | shape it needs | why the fixture cannot give it |
|---|---|---|
| `pilotAcceptanceGateCli.test.js` | a repo with NO commit and no `main` | four tests assert "throws when the repo has no commit yet" / "returns undefined when main does not exist" — the EMPTY state is their subject |
| `config.test.js` | a repo with NO identity configured | the two BL-443 defect-3 tests assert the fallback author identity, and the isolation check beside them |
| `blTopicStore.test.js` | a BARE push remote | the durability test pushes to it and re-reads `rev-parse main`; a bare repo is a different artifact |

Each keeps its own `git init` for exactly those sites; every OTHER repository in
those same files is taken from the fixture.

## D4 — the gate was never armed

`findRepoCreations` was exported and called from nowhere in either lane, so the
59 violations were invisible to `npm test` and would have stayed invisible after
merge. Two callers now, matching what BL-1038's and BL-1032's guards each have:

- `extension/test/repoCreationGuard.test.js` — **new**, 16 tests: the call
  shapes, the executing-vs-asserting rule, the exemption relation, self-exemption,
  and the lane-level scan of the real tree.
- Acceptance scenario 07 ("the guard is armed over the whole unit lane, not just
  a sample"), whose four steps had **no handlers at all** — it arrived from
  `main` with the payload merge, the same shape as BL-1038's scenario 07. Written
  here, including `every exempted file records the repository shape it needs`,
  which fails a bare marker and a reason under 20 characters.

## Two design decisions this rework had to make

**The template's branch is pinned to `main`.** The seed ran a bare `git init`, so
the branch was whatever the host's `init.defaultBranch` happened to be, and a
converted caller running `git checkout main` then passed or failed by machine
configuration rather than by its own subject — `bounceRevertCheck.test.js` seeded
`init -q -b main` itself for exactly that reason. Pinned in the fixture and
asserted by a new test in `sharedRepoFixture.test.js`.

**`mkProcessTmpDir`, added to `helpers/tmpDir.js`.** The ported fixture allocated
its template with a raw `fs.mkdtempSync`, which `tmpDirMigrationGuard` correctly
flagged (BL-420). The template cannot use either existing sweep — `mkTmpDir` is
per-test, `mkSharedTmpDir` per-file, and with `isolate: false` a per-file sweep
re-pays the seeding in the next file that asks. Rather than widen
`rawMkdtempGuard`'s exempt list — whose own test says "the exempt list is exactly
the three documented paths, nothing was added to buy a green scan" — the
process-lifetime primitive now lives in the module that owns temp-dir policy,
cleans up on process exit, and **the exempt list is untouched**. The per-caller
copies go through `mkTmpDir` and are swept normally.

## Measured

The ticket's own 14 files, from this line's `.vitest-report.json`:

| file | ticket | now | | file | ticket | now |
|---|---|---|---|---|---|---|
| epicReorderBridge | 49.7s | **4.94s** | | proposeOnboardingContractCli | 2.8s | **0.39s** |
| telegramFrontDeskBotCli | 30.2s | **5.82s** | | pausedPagerBridge | 2.3s | **0.82s** |
| topicMakeTopBridge | 18.6s | **4.18s** | | commitIntegrityRunner | 2.0s | **0.63s** |
| drainAnswerFilesCli | 13.8s | **2.08s** | | proposeOnboardingPromptsCli | 1.6s | **0.50s** |
| epicMakeTopBridge | 9.3s | **1.94s** | | runRoleBenchmarkCli | 1.4s | **0.28s** |
| pilotAcceptanceGateCli | 5.7s | **1.84s** | | leanLedgerCompose | 0.8s | **0.16s** |
| negotiateOnboardingContractCli | 3.1s | **2.70s** | | relayOnboardingNegotiationTelegramCli | 2.9s | **1.20s** |

**144.2s → 27.5s.** Stated with its caveat: the ticket's figures were profiled on
a 1-fork macOS host and these are this WSL host, so the two columns are not a
like-for-like control. The robust structural facts, from the same run, are that
**all 467 files are within BL-378's 7000ms per-file budget** (max 5.82s) and that
every one of the 14 is now well inside it.

Invariant 3 (speed never bought with coverage): `.test-durations.jsonl`
`test_count` **599 → 603** — rose. No test deleted, none skipped, no exclude
glob widened; the diff adds a test file and converts fixtures.

## Verification

- Unit lane: **466 of 467 files, 8259 of 8260 tests pass.**
- Acceptance `BL-1039-unit-tests-share-one-seeded-git-fixture.feature` — **8/8**.
- `repoCreationGuard.test.js` 16/16; `sharedRepoFixture.test.js` 8/8;
  `tmpDirMigrationGuard.test.js` green; `bl1039SharedRepoFixture.property.test.js` 2/2.
- Every converted file's own suite was run as it was converted, in batches —
  not sampled at the end. Four regressions were caught and fixed that way:
  `bounceRevertCheck` (branch name), `reworkObservatory*`/`suboptimalityVerdictLineCli`
  (a now-redundant `checkout -b main`), `pilotAcceptanceGateCli` and `config`
  (the empty/unconfigured-repo subjects, which became the exemptions above).

## Pre-existing failures — surfaced, not swept, and not mine

**Unit lane, 1 file:** `tempDirTrapGuard.test.js` → BL-1025's
`bl1025_expedite_approval_property_runner.bb`. Last touched by `71ee902a2`, an
ancestor of both `main` and `origin/main` — red on `main` itself.

**Property lane, 5 files** (`npm run test:properties`: 134 of 139 files,
396 of 404 tests pass). None names a file this parcel touched, and this parcel's
only edit to shared machinery — `helpers/tmpDir.js` — is purely additive (one new
function, one new export entry; every existing export byte-identical).

- `tempDirTrapGuard.property.test.js` (2) — **caused by stale scratch checkouts
  in `./tmp/`**: `tmp/bl508-clean`, `tmp/bl520-clean-head-{6nwqo5,Ea8MoE,wxKDq6}`,
  `tmp/bl538-clean`, `tmp/bl538-rework` are full repo copies left by earlier
  sessions (July), and the repo-wide "defined in exactly one file" scan walks
  into them and counts 7 definitions instead of 1. `./tmp/` also holds
  `bl340-*.json`, `BL-466/482/485-*.md` from July.
  **Not deleted**: I did not create them, and ticket-less artifacts are surfaced,
  not swept. They will keep failing this property for every role until someone
  who owns them clears them, and they are a false red for any future parcel.
- `bl968MaterializedGuardSensitivity.property.test.js` — a generator REACH-FLOOR
  flake in its own sampling: "reach floor: class live-repo-read drawn 3 < 5 of
  24". Its own draw, nothing to do with the subject.
- `bl643NonPipelineAgentPaths` (2), `bl796NvmNodePathFollowUpAdoptInvariants`,
  `bl857TunnelOwnershipInvariants` (2) — launcher-table rows, daemon PATH
  resolution and tunnel process reaping. None requires anything in this diff.
