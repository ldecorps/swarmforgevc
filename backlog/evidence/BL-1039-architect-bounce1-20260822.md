# BL-1039 — architect SEND BACK #1: the guard misses the majority of its own target — a `git()` local-wrapper call shape it never checks for — and neither lane ever runs it against the real tree

**Parcel:** cleaner-forwarded commit `ac91f18832` ("Merge coder BL-1039 into
cleaner"), merged for architect review at `fcabc0789` on
`swarmforge-architect`.

**Verdict: SEND BACK.** `sharedRepoFixture.js`'s design and isolation
guarantee are sound — structural per-caller `fs.cpSync` copies from a
once-seeded template, no shared mutable state, verified below. But
`repoCreationGuard.js`'s detection regex only recognizes ONE call shape
(`execFileSync('git', ['init', ...])` — `'git'` as a literal string
argument) and is completely blind to the equally common **local wrapper
function named `git`** (`function git(cwd, args) { execFileSync('git',
args, {cwd}); }`, called as `git(dir, ['init', '-q'])`) — a pattern used in
**43 test files** in this repository, none of which the guard sees. Adding
the guard-detectable 16 remaining violations (files the guard COULD flag
but nobody ever asked it to, because no standing test calls
`findRepoCreations` against the real tree), this ticket's invariant is
currently violated at **59 files**, against a ticket scope of 17.

---

## D1 — the guard's core regex has a blind spot covering the majority call shape (`git()` wrapper, not `execFileSync('git', ...)`)

`repoCreationGuard.js:23`:
```js
const CREATES_A_REPO = /['"]git['"]\s*,\s*\[\s*['"]init['"]|['"]git\s+init\b|\binit\b[^\n]*--bare/;
```
This requires `'git'` (or `"git"`) to appear as a quoted STRING argument.
It cannot match a call to a local function literally named `git`:
```js
function git(cwd, args) { execFileSync('git', args, { cwd }); }
...
git(dir, ['init', '-q']);   // <- 'git' here is a bare identifier, not a string
```
Verified this is the DOMINANT shape in the corpus, not an edge case:

```
$ grep -lE "git\([^,]+,\s*\[\s*'init'" extension/test/*.test.js | grep -v .property.test.js | wc -l
44
```
(44 files define/call this idiom; `swarmMetricsCli.test.js` calls it 3
times over. One of the 44, `telegramFrontDeskBotCli.test.js`, is ALSO
guard-detected via a separate remaining inline `execFileSync` call — see
D2 — so the wrapper-only blind-spot count is 43.)

Cross-checked against `findRepoCreations`'s own output — **zero overlap**:
none of these 43 appear in the guard's violation list. Confirmed on two
representative files, not just by pattern:
```
$ grep -n "function git(\|git(.*\['init'" extension/test/swarmMetrics.test.js
30:function git(cwd, args, dateIso) {
40:  git(dir, ['init', '-q']);
$ grep -n "function git(\|git(.*\['init'" extension/test/recertificationStore.test.js
29:function git(cwd, args) {
130:  git(root, ['init', '-q']);
176:  git(root, ['init', '-q']);
286:  git(root, ['init', '-q']);
```
Both spawn real `git init` per call, neither imports
`sharedRepoFixture`/`repoCreationGuard`, neither is named by
`findRepoCreations`.

**Full list of the 43** (from the reproduction command above, minus
`telegramFrontDeskBotCli.test.js`): `applyCooldownPauseCli`,
`backfillEpicTopicIconsCli`, `backfillQaBouncesCli`,
`backfillStandingTopicIconsCli`, `backfillTopicIconsCli`,
`backlogDashboard`, `benchmarkReportArtifact`, `bounceRevertCheck`,
`bridgeState`, `coChangeReportCli`, **`costHealthSidecar`** (one of the
ticket's own three reassigned files — see D3), `deliveryMetricsIntegration`,
`emitCostHealthSidecarCli`, `generateBacklogDashboardCli`,
`generateDocsTreeCli`, `gitCommitScopedFile`, `needsApprovalLineCli`,
`notDoneCountLineCli`, `notifyDeadLettersCli`, `operatorDecideCli`,
`parkCycleReportCli`, `qaBounceLineCli`, `qaSiblingCheckCli`,
`queueStatusCli`, `recertificationStore`, `recordBounceCli`,
`recordBounceCorrectionCli`, `recordQaBounceCli`,
`repairBlTopicRecordsCli`, `resumeExpiredPausesCli`,
`reworkObservatoryCli`, `reworkObservatorySource`, `sampleResourcesCli`,
`stageDwellReportCli`, `suboptimalityVerdictLineCli`,
`suiteDurationLineCli`, `swarmCostRankCli`, `swarmMetrics`,
`swarmMetricsCli`, `telegramBridgeCostLineCli`, `tokenBurnSectionCli`,
`topicDeletion`, `usageAnchorCli` (all `.test.js`, `extension/test/`).

**Remediation:** the guard's job, per the ticket's own words ("How the
guard identifies... is the implementer's call") — extend `CREATES_A_REPO`
(or its surrounding logic) to catch a call to any local identifier bound to
an `execFileSync`/`spawnSync`/`exec` wrapper around `'git'`, not only a
literal inline `'git'` string. A regex keying on the call-site alone
(`\bgit\(\s*[^,]+,\s*\[\s*['"]init['"]`) would catch the wrapper-call SHAPE
directly without needing to trace the wrapper's own definition — cheaper
than resolving the binding, and this ticket's own `CREATES_A_REPO` already
takes that shortcut for the `execFileSync('git', ...)` case.

## D2 — 16 files the guard CAN detect are still violations today (guard-detectable, simply unconverted)

```
$ node -e "console.log(require('./test/helpers/repoCreationGuard.js').findRepoCreations('./test').length)"
16
```
Includes files the ticket's own table explicitly named and measured:
`drainAnswerFilesCli.test.js` (13.8s), `pilotAcceptanceGateCli.test.js`
(5.7s), `negotiateOnboardingContractCli.test.js` (3.1s),
`relayOnboardingNegotiationTelegramCli.test.js` (2.9s),
`proposeOnboardingContractCli.test.js` (2.8s),
`proposeOnboardingPromptsCli.test.js` (1.6s), `runRoleBenchmarkCli.test.js`
(1.4s), `leanLedgerCompose.test.js` (0.8s), plus the two files the
amendment reassigned into this ticket: `gitHistoryAdapter.test.js`,
`blTopicStore.test.js`. Plus `telegramFrontDeskBotCli.test.js` —
**partially** converted: `copySeededRepoInto(root)` is now called at line
327, but three more inline `execFileSync('git', ['init', '-q'], { cwd:
root });` calls remain at lines 3123/3130/3137, uncoverted. Plus four files
outside the ticket's own table entirely (`config.test.js`,
`prCreator.test.js`, `traceHopCli.test.js`, `traceHopMain.test.js`,
`workTree.test.js`) — the declared invariant is unconditional ("No
unit-lane test creates a git repository of its own"), not scoped to the
profiled 17, so these are in-scope violations too, same as BL-1038's
equivalent finding.

## D3 — `costHealthSidecar.test.js`, one of the ticket's own three reassigned files, is untouched

Explicitly named in this ticket's own amendment ("Three files move INTO
this ticket... `costHealthSidecar.test.js` (4.4s, 4)"). Verified: no
`sharedRepoFixture`/`copySeededRepoInto`/`checkoutSeededRepo` reference
anywhere in the file; its own local `git(cwd, args, dateIso)` wrapper (line
846) still calls `git(target, ['init', '-q'])` at least 8 times. This is
D1's blind spot hitting the ticket's own explicitly-claimed scope, not just
the wider corpus.

## D4 — no standing test runs the guard against the real committed tree, in either lane

Both siblings this ticket is modeled on (BL-1038's
`liveRepoDerivationGuard.test.js`, BL-1032's `tmuxReaperGuard.test.js`)
carry a `.test.js`-lane assertion equivalent to "the real tree has zero
violations" — a live, continuously-enforced gate. This parcel's
`findRepoCreations` (the whole-tree scanner) is exported but **never
called** anywhere:
```
$ grep -rn "findRepoCreations" extension/ specs/
extension/test/helpers/repoCreationGuard.js:87:function findRepoCreations(testDir) {
extension/test/helpers/repoCreationGuard.js:101:module.exports = { ... findRepoCreations ... };
```
No `repoCreationGuard.test.js` exists (referenced in the guard's own
`SELF_EXEMPT` list at line 79, as if it should) and the acceptance feature
(`BL-1039-unit-tests-share-one-seeded-git-fixture.feature`, 6 scenarios)
tests the guard's LOGIC entirely through synthetic fixture text/files —
none of its scenarios scan the real corpus. This is why D1–D3 above are
currently invisible to `npm test`: nothing fails today despite 59 real
violations, and nothing will fail after this parcel merges as-is either,
which is exactly the "gate that is always red trains everyone to wave it
through" failure this epic exists to prevent — inverted here into a gate
that can never usefully turn red at all.

---

## What is NOT the problem — do not change

- `sharedRepoFixture.js`'s design: per-caller `fs.cpSync` from a
  once-seeded template, no `git clone` spawn, `register` callback for
  caller-owned cleanup. Sound, and isolation is STRUCTURAL (two callers
  physically cannot share a directory) rather than disciplined.
- Invariant 2 (isolation) property test
  (`bl1039SharedRepoFixture.property.test.js`, "no caller ever observes
  another caller's writes") — rigorous, real git operations, both
  writer-first/writer-last orderings, both single- and multi-writer runs,
  documented non-vacuity. No defect found here.
- The exemption mechanism (`BL-1039-EXEMPT:` + reason, same newline-trap
  fix as BL-1038's) and its property coverage — correct.
- The 6 files legitimately converted so far (`epicReorderBridge`,
  `topicMakeTopBridge`, `epicMakeTopBridge`, `pausedPagerBridge`,
  `commitIntegrityRunner`, plus `telegramFrontDeskBotCli`'s partial
  conversion) — what IS converted in them is correct; `telegramFrontDeskBotCli`
  just isn't finished (D2).

## Checks completed this pass (Article 4.4 — full inventory)

- **Dependency-gate (hard gate):** same pre-existing `telegram-front-desk-bot.ts
  → telegramCursorOperatorExec.ts → telegramCursorOperatorLiveness.ts`
  cycle as every recent pass this session — confirmed pre-existing, already
  tracked as `backlog/paused/BL-759-...yaml`. Not this parcel's defect.
- **Co-change report (informational):** only the codebase's usual hub-file
  coupling (`bridgeServer.ts`, `specs/pipeline/steps/index.js`,
  `telegram-front-desk-bot.ts`) — nothing parcel-specific flagged.
- **Invariant 3** ("speed is never bought with coverage"): correctly NOT
  encoded as a property (stated non-encodability reason in the property
  test's header, same shape as BL-1038's). Hand-verified this pass: no
  `.skip`/`.only` in the diff, no vitest config/exclude change.
- `npm run compile` — green. All 8 directly-touched unit-lane files run
  green (364/364) and the 4 relevant property files run green (7/7) — see
  the merge commit `fcabc0789` for that verification; unaffected by D1-D4,
  which are about files this parcel did NOT touch.

## Merge note

`ac91f18832` conflicted with this branch's standing BL-1038 revert on the
6 shared files (`extension/test/helpers/pinnedRepoFixture.js` needed
restoring — see the merge commit `fcabc0789` for the full account, including
a caught silent auto-merge drop). Unrelated to D1-D4 above.

*Recorded via `record-bounce.js --by architect` (BL-635).*
