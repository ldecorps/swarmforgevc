# BL-1039 architect pass — 2026-08-22 (live-line re-fix, clears architect SEND BACK #1)

**Parcel:** cleaner-forwarded commit `88f114f998` ("Merge coder 5deb04b175
(BL-1039) into cleaner"), merged into `swarmforge-architect` at `87cc32169`.

## Merge required careful conflict resolution, not a mechanical accept-theirs

8 conflicts: the 6 files shared with BL-1038 by operation (`epicReorderBridge`,
`epicMakeTopBridge`, `pausedPagerBridge`, `topicMakeTopBridge`,
`commitIntegrityRunner`, `bl687EpicTileSurfaceUntouched`), plus
`telegramFrontDeskBotCli.test.js` and `specs/pipeline/steps/index.js`. This
branch carries BL-1038 as a **bounced, reverted** ticket (architect bounce
#2, `66e8fc675`, still unresolved — see
`backlog/evidence/BL-1038-architect-bounce2-20260822.md`); BL-1039's incoming
lineage still had BL-1038's `copyLiveScriptClosureInto`/`pinnedRepoFixture.js`
merged in from before that revert. A naive accept-theirs would have silently
resurrected the bounced content.

Resolved each conflict to keep BL-1039's own fix (`copySeededRepoInto`
replacing the manual `git init`/`config`/`commit` sequence) while restoring
the **pre-BL-1038** whole-directory `readdirSync` copy for the
`swarmforge/scripts/` portion (since BL-1038's closure-copy conversion of
that same operation is still bounced on this branch). Dropped the now-dead
`copyLiveScriptClosureInto` import wherever it was unused entirely
(`commitIntegrityRunner.test.js`, `telegramFrontDeskBotCli.test.js`).
`index.js`: kept BL-1048's and BL-1032's registrations, dropped BL-1038's,
added BL-1039's. **Verified post-merge**: `grep -rl copyLiveScriptClosureInto
extension/ specs/` and `ls extension/test/helpers/pinnedRepoFixture.js` both
confirm nothing from BL-1038 resurfaced.

## This clears a real prior bounce, on a different lineage — verified, not assumed

A prior architect session bounced this exact ticket at `63bddf4d1` ("guard is
blind to the git() wrapper shape, 59 real violations", D1-D4). That bounce is
not an ancestor of this parcel (same live-line/cutover-branch stranding
pattern as BL-1038 and BL-1032), but — unlike BL-1038's port — this parcel's
own commit message and evidence
(`backlog/evidence/BL-1039-coder-bounce1-refix-20260822.md`) explicitly
address every item D1-D4. Verified each independently rather than trusting
the claim:

- **D1** (guard blind to the `git(dir, ['init', ...])` local-wrapper call
  shape): `CREATES_A_REPO` now includes
  `\bgit\(\s*[^,()]+,\s*\[\s*['"]init['"]`. Confirmed directly against
  `createsRepository()`: the wrapper-call shape → `true`; the pre-existing
  inline shape → `true`; the fixture helper's own internal `gitIn(...)` spawn
  → correctly `false` (not widened into the BL-1032 defect repeated one guard
  over); a proper whole-line-string-literal assert-only fixture → correctly
  `false`.
- **D2/D3** (59 real violations, including the ticket's own
  `costHealthSidecar.test.js`): `findRepoCreations('./test')` over the real
  tree → **0** (was 59 pre-fix, per the bounce). Spot-checked the two files
  the bounce used as its own reproduction evidence
  (`swarmMetrics.test.js`, `recertificationStore.test.js`): both still define
  a local `git()` wrapper (for non-creation calls) but their actual `git
  init` call sites are gone, replaced by `copySeededRepoInto`/
  `checkoutSeededRepo` — genuinely fixed, not merely guard-blinded. Three
  named exemptions (`pilotAcceptanceGateCli.test.js`, `config.test.js`,
  `blTopicStore.test.js`) each carry a substantive `BL-1039-EXEMPT:` reason
  naming the specific repository SHAPE the shared fixture cannot express (no
  commit, no identity, bare remote) — confirmed each file still uses the
  shared fixture at every OTHER call site (2-15 uses each), so the exemption
  is scoped to the one genuinely-different site, not a blanket file opt-out.
- **D4** (guard unwired, 59 violations invisible to `npm test`):
  `extension/test/repoCreationGuard.test.js` is a real `.test.js` file in the
  default lane (16/16 pass, confirmed) whose own test asserts
  `findRepoCreations(path.join(__dirname))` is `[]` against the real tree —
  matches the required_wiring field verbatim. Acceptance scenario 07/08 (the
  lane-level scan) drives the same real scanner over the real
  `extension/test` directory, not a fixture string — confirmed by reading
  `bl1039SharedSeededFixtureSteps.js` directly.

## Correctness — reproduced independently, full-scale

- `npm run compile` — green (post-merge-resolution).
- **Full default unit lane** (`npm test`): **464/465 files, 8241/8242 tests
  pass.** The one failure is `tempDirTrapGuard.test.js` →
  `bl1025_expedite_approval_property_runner.bb`, confirmed pre-existing:
  last-touching commit `71ee902a2` is an ancestor of both `main` and
  `origin/main`. Suite file budget OK (all 465 files within BL-378's 7000ms).
- **Full property lane** (`npm run test:properties`, run in background —
  154.9s): **134/138 files, 396/402 tests pass.** 4 failing files
  (`bl643NonPipelineAgentPaths`, `bl796NvmNodePathFollowUpAdoptInvariants`,
  `bl857TunnelOwnershipInvariants`, `bl968MaterializedGuardSensitivity`) —
  confirmed NONE is in this parcel's diff and each file's last-touching
  commit (`e1c39eef3`/`c9531412e`/`c4f2552db`/`20e315ceb`) is an ancestor of
  `main`: pre-existing, environment/load-sensitive, unrelated. 2 unhandled
  errors, both the exact allowlisted `[vitest-worker]: Timeout calling
  "onTaskUpdate"` benign artifact per engineering.prompt — not a real
  failure.
- **Isolation (invariant 2, the highest-risk claim)**:
  `bl1039SharedRepoFixture.property.test.js` re-run directly, 2/2 pass. Read
  the property in full — real git checkouts, both writer-first/writer-last
  orderings, multi- and single-writer coverage floors, checks BOTH that a
  writer sees its own commit AND that no non-writer/other-writer ever
  observes a foreign commit/file, proper `finally` cleanup. Non-vacuity
  documented at authoring time (two independent breaks, each restored,
  each biting its OWN invariant) — accepted on the header's explicit
  before/after evidence, consistent with how this role treats a documented,
  falsifiable non-vacuity claim (same posture as the prior BL-1032 pass).
- Acceptance feature run live: `node specs/pipeline/cli.js
  specs/features/BL-1039-unit-tests-share-one-seeded-git-fixture.feature` →
  **8/8 pass**, including scenario 07/08's lane-level guard scan.
- Spot-checked 6 of the 17-family conversions directly
  (`blTopicStore`, `costHealthSidecar`, `gitHistoryAdapter`,
  `drainAnswerFilesCli`, `config`, `pilotAcceptanceGateCli`): 257/257 tests
  pass.
- `mkProcessTmpDir` (new primitive in `helpers/tmpDir.js`, needed because the
  template must outlive both the per-test and per-file sweeps): read in
  full. Cleans up via `process.once('exit', ...)` inside a try/catch — robust
  against throw/bounce, matches BL-971's "removed in a finally, never only
  after the last assertion" rule, just at process granularity instead of
  test granularity (correct, since this is a process-lifetime resource).
  `tmpDirMigrationGuard.test.js`'s own "the exempt list is exactly the three
  documented paths" test re-run: 11/11 pass — confirms the exempt list was
  NOT widened to accommodate this addition, exactly as claimed.

## Dependency-rule gate (BL-259, hard gate)

`node out/tools/dependency-gate.js` scoped to this parcel's ~71 changed
`extension/test/` files: reports the same pre-existing 3-edge `acyclic`
cycle (`telegram-front-desk-bot.ts → telegramCursorOperatorExec.ts →
telegramCursorOperatorLiveness.ts`) seen on every recent pass this session.
Confirmed via `git log` that none of those three source files is in this
parcel's diff (surfaced only because `telegramFrontDeskBotCli.test.js`
imports the production module transitively) and it is already tracked at
`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`.
Not this parcel's defect, not a bounce reason.

## Co-change report (informational, BL-255)

Run over the parcel's ~71 changed files. All SUSPECTED COUPLING flags are
pre-existing, naturally-related feature pairs (e.g.
`generateBacklogDashboardCli.test.js` × `backlogDashboard.ts` × `pwa/app.js`;
`epicReorderBridge.test.js` × `bridgeServer.ts` × `epicReorderUiHtml.ts`) —
each file's own feature siblings, unrelated to this parcel's uniform
mechanical fixture-swap. Nothing new or suspicious introduced.

## Invariant 3 (speed never bought with coverage)

`git diff` over the parcel's whole range confirms: no `.skip`/`.only`/
`describe.skip` added, no `vitest.config.mjs`/`vitest.properties.config.mjs`
exclude-glob change. `.test-durations.jsonl` is gitignored/worktree-local
(not authoritative for a cross-session comparison — that check is QA's own
qa_e2e step 7); my own full-lane run count (8241/8242, well above the prior
recorded baselines) and the diff-based checks above are sufficient
confirmation at this stage.

## What is NOT the problem — do not change

- `sharedRepoFixture.js`'s design: lazy one-time seeding via
  `mkProcessTmpDir`, structural per-caller `fs.cpSync` isolation, pinned
  `-b main` template branch, no git spawn per caller. Sound.
- The three recorded exemptions and their scoping — legitimate, narrow,
  substantive.
- `mkProcessTmpDir` and its exit-time cleanup — correct, additive-only.
- The guard's file-level (not call-site-level) exemption granularity is
  shared by this design with BL-1032's and BL-1038's sibling guards; not a
  new concern this parcel introduces, and every exemption file currently
  has exactly one genuinely-exempt site — no latent gap observed in
  practice.

## Verdict

COMPLIANT. Architect SEND BACK #1 is cleared, independently reverified
against the real guard, real files, and the full unit + property lanes.
Forwarding to hardener.

*Recorded via `record-bounce.js` is not applicable — this pass PASSES, no
send-back to record.*

By architect.
