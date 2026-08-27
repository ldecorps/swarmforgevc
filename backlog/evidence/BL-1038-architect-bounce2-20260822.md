# BL-1038 — architect SEND BACK #2: same defect as bounce #1, on a lineage that never saw it

**Parcel:** cleaner-forwarded commit `dc0514a925` ("dedupe the eight
copyScriptClosure call sites into one helper"), merged for architect review
at `8ba78fd7f` on `swarmforge-architect`.

**Verdict: SEND BACK.** This is the same defect a prior architect session
already found and bounced at `125be7981` ("BL-1038 architect bounce #1:
guard misses the 4 named files it was minted to fix", 2026-08-22 11:31:32).
That bounce is **not an ancestor** of this parcel
(`git merge-base --is-ancestor 125be7981 dc0514a925` fails). Per the coder's
own evidence (`backlog/evidence/BL-1038-coder-port-and-restore-20260822.md`),
this parcel was built by porting three commits off a stale
`origin/cutover/wsl-2026-08-22-*` snapshot branch (divergence point
`82180f665`, well before the 11:31 bounce) rather than continuing the live
`swarmforge-*` branch line the bounce landed on. The fix instruction in
bounce #1 never reached this lineage.

## D1 (the bounce) — invariant 1 is violated at 4 sites the guard cannot see

Full technical detail already recorded at bounce #1
(`backlog/evidence/BL-1038-architect-bounce1-20260822.md`) — re-verified
independently here against `dc0514a925` rather than re-derived:

```
$ node -e "const {liveRepoDerivation}=require('./test/helpers/liveRepoDerivationGuard.js');
const fs=require('fs');
for (const f of ['renderBriefingDiagramsCli','renderBriefingBurndownCli','briefingDigestLineCli','emitLifecycleSnapshotCli'])
  console.log(f, liveRepoDerivation(fs.readFileSync('test/'+f+'.test.js','utf8')));"
renderBriefingDiagramsCli null
renderBriefingBurndownCli null
briefingDigestLineCli null
emitLifecycleSnapshotCli null
```

Same four files, same amounts (~99.9s combined per the ticket's own amended
table), same root cause: `growthPatternsFor()` only matches a growth
operation (`git log|rev-list|shortlog`, `readdirSync`, `glob`) written
**inline in the test file's own source**, bound to a
`path.join(__dirname, '..', '..')` variable in that same file. All four
files reach the live repository **indirectly**, through a production module
(`renderBriefingDiagrams`, `renderBriefingBurndown`, the digest-line CLI, the
lifecycle-snapshot walker) that the guard's static scan never sees. None of
the four carries a `BL-1038-EXEMPT:` marker. `findLiveRepoDerivations` over
`extension/test` still reports `[]` — the acceptance scenario 01 claim ("a
unit-lane test that derives from the live repository is named as a
violation") is exercised only by synthetic step-handler text, never by these
four real files, so it passes while the ticket's own headline cost — the
majority of it — is still live in the tree.

This parcel's own evidence file discloses the gap honestly (credit where
due — it is not a silent omission) and argues it is a ratified scope
decision: "the specifier ruled twice that the delivered commit satisfies the
amendment." I could not find a second ruling in the ticket's own `notes:`
(only one AMENDMENT FOLLOW-UP note exists, and it discusses satisfaction of
the *six shared files* list only — never the four headline readers, which
the amendment itself names as "this ticket's actual live-repository
readers"). Whatever that second ruling was, it predates or is orthogonal to
the concrete, already-recorded architect bounce at `125be7981` (11:31),
which is later than this parcel's divergence point and was never merged
into it. A structural gate that the ticket was minted to close, and that a
peer architect pass already named as the reason to send back, is not
something I can wave through on an unverifiable claim of prior clearance —
per this role's standing instruction, a missed real defect ships the bug;
a false send-back costs one rebuild.

**Remediation is unchanged from bounce #1:** either (a) extend the guard to
see through a bound call into production-module code, or (b) record a
`BL-1038-EXEMPT:` reason on each real-derive call site in these four files
and extend the guard to actually reach them. Whichever direction,
`liveRepoDerivationGuard.test.js`'s "real tree is clean" assertion must stop
passing vacuously with respect to these four files.

One violated property at four sites — one bounce item per Article 4.4,
not four.

## Checks completed this pass (Article 4.4 — full inventory, not first-failure)

- **Dependency-gate (hard gate, BL-259):** ran `npm run compile` fresh, then
  `node out/tools/dependency-gate.js` both scoped to this parcel's changed
  files and full-repo (no args). Both report the same pre-existing 3-edge
  `acyclic` cycle: `telegram-front-desk-bot.ts → telegramCursorOperatorExec.ts
  → telegramCursorOperatorLiveness.ts`. Confirmed via `git log` that none of
  those three files is in this parcel's diff (last touched by `4c334f349`,
  an unrelated BL-1036 commit) and the same cycle is already tracked at
  `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`,
  matching precedent at bounce #1 and at `BL-937`/`BL-961` architect passes.
  Not this parcel's defect, not a bounce reason.
- **Co-change report (informational, BL-255):** ran over all 14 non-evidence
  changed files (18 total minus the 4 backlog-record files). Flagged pairs
  (`epicMakeTopBridge.test.js` × `bridgeServer.ts`/`makeTopPrioritySafety.ts`,
  `epicReorderBridge.test.js` × `bridgeServer.ts`/`epicReorderUiHtml.ts`,
  etc.) all reflect pre-existing, legitimate bridge-test/bridge-server
  coupling for those features — nothing this parcel introduces or that
  looks suspicious. This parcel's actual edits to those files are a
  mechanical one-line closure-copy swap.
- **Cleaner's dedup commit (`dc0514a925` itself), reviewed directly:**
  behavior-preserving refactor — collapses eight hand-rolled
  `copyScriptClosure(path.join(__dirname,'..','..','swarmforge','scripts'),
  scriptsDir, entrypoints)` call sites into one shared
  `copyLiveScriptClosureInto(targetScriptsDir, entrypoints)` helper in
  `pinnedRepoFixture.js`. Same entry-point lists, same live-scripts-dir
  resolution (now centralized, relative to the helper file itself rather
  than each caller's own `__dirname`), redundant `mkdirSync` calls removed
  (already done inside `copyScriptClosure`). No behavior change; does not
  touch D1 at all. Independently re-ran all affected suites (see below) —
  clean.
- **Invariant 2** (exemption honoured only with a recorded reason): encoded
  non-vacuously in `bl1038PinnedFixture.property.test.js` (200-run property
  per assertion, including the newline-trap case) and example-tested in
  `liveRepoDerivationGuard.test.js`. Re-ran both — 2/2 and 11/11 pass. Sound.
- **Invariant 3** (test_count never falls, nothing deleted/skipped/excluded):
  correctly NOT encoded as a property — stated non-encodability reason in
  the property test's own header (quantifies over successive suite runs and
  a diff against a parent commit, not a pure module's input space). The
  acceptance scenario 06 step handler checks it directly against the six
  converted files (no `.skip`/`.only`, none missing). Hand-verified via
  `git diff` over the parcel: no test file deleted, no skip/only added, no
  vitest config/exclude glob change.
- **Property coverage of touched pure modules:** `resolveScriptClosure`
  (pinnedRepoFixture.js) and the guard's own pure functions
  (`liveRepoDerivation`, `exemptionReason`, `violationFor`) are covered by
  `bl1038PinnedFixture.property.test.js`; non-vacuity is demonstrated in the
  test file's own header (documented break-then-fix reasoning, including why
  a second candidate break is structurally unrepresentable) rather than
  merely claimed.
- **Independently re-ran the full touched-file test surface** (not just
  trusted the commit message): `liveRepoDerivationGuard.test.js` (11/11),
  `pinnedRepoFixture.test.js` (7/7), `bl1038PinnedFixture.property.test.js`
  (2/2), `bl687EpicTileSurfaceUntouched.property.test.js` (1/1),
  `bl892ApprovalCommitDurability.property.test.js` (2/2),
  `commitIntegrityRunner.test.js` (8/8), `epicMakeTopBridge.test.js`
  (16/16), `epicReorderBridge.test.js` (36/36), `pausedPagerBridge.test.js`
  (15/15), `topicMakeTopBridge.test.js` (15/15),
  `telegramFrontDeskBotCli.test.js` (260/260). All green — matches the
  coder's/cleaner's own claims exactly.
- Scenario 07 restore (this parcel's differentiator from bounce #1's
  reviewed commit) — read in full: `specs/features/BL-1038-...feature.draft`
  is deleted, the live `.feature` file carries 7 scenarios, all step
  handlers present in `bl1038UnitTestsPinTheRepoSteps.js` and registered in
  `specs/pipeline/steps/index.js`. Structurally sound, matches the ticket's
  own AMENDMENT FOLLOW-UP instructions.

## What is NOT the problem — do not change

- The six converted `*Bridge`/`commitIntegrityRunner`/
  `telegramFrontDeskBotCli` tests' switch to `copyLiveScriptClosureInto` —
  correct, keep as-is.
- The cleaner's dedup of the eight call sites into one helper — correct,
  keep as-is.
- `liveRepoDerivationGuard.js`'s self-exemption list and exemption-regex
  newline-trap handling — correct, keep as-is.
- Scenario 07's restoration and its step handlers — correct, keep as-is.
- The acceptance feature scenarios (01-07) — all structural, none need
  rewriting; they will have something real to exercise once D1 is closed.

*Recorded via `record-bounce.js --by architect` (BL-635).*

By architect.
