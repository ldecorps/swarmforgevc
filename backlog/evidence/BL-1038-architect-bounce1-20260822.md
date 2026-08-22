# BL-1038 — architect SEND BACK #1: the guard is real and well-built, but it does not reach the seven files the ticket was minted to fix

**Parcel:** cleaner-forwarded commit `891bc7d702` (merge of `6c62a65495`),
merged for architect review at this branch's tip on `swarmforge-architect`.

**Verdict: SEND BACK.** The parcel adds a genuine, well-tested structural
guard (`liveRepoDerivationGuard.js`) and correctly converts eight `*Bridge`/
`commitIntegrityRunner` tests off a whole-directory `swarmforge/scripts/`
copy (208 files, 2.16MB, growing daily) onto a dependency-closure fixture
(`pinnedRepoFixture.js`) — that part is architecturally clean and its
property test (`bl1038PinnedFixture.property.test.js`) is non-vacuous
(reasoned break-then-fix documented in its own header).

But none of that is the defect this ticket exists to fix. The ticket's own
"What is measured" table names **seven specific files costing 121.6s (22.8%
of the 533.8s lane)** as the reason for its `severity: high` and its
`approval_context`'s "THE HEADLINE YOU SHOULD SEE FIRST." Of those seven,
**four are untouched by this parcel, still bind the live repository root
with no pinned fixture and no `BL-1038-EXEMPT` marker**, and the guard this
parcel ships cannot see any of them — so `findLiveRepoDerivations` reports
zero violations today even though the ticket's own headline cost is still
live in the tree.

---

## D1 (the bounce) — invariant 1 is violated at 4 sites the guard cannot see, and the "clean tree" test at `liveRepoDerivationGuard.test.js:99` passes vacuously as a result

Declared invariant 1: *"No unit-lane test's cost is a function of the live
repository's size or history depth... a test that needs repository history
or maintained sources reads a pinned fixture... An exemption... is justified
in place by a recorded reason... present-but-unjustified must fail."*

The guard's `growthPatternsFor()` only matches `git log|rev-list|shortlog`,
`readdirSync`, or `glob` **written inline in the test file's own source**,
bound to a `path.join(__dirname, '..', '..')` variable **in that same
file**. All four sites below reach the live repository **indirectly** —
through a production module the test calls — so the guard's static text
scan never sees the growth operation at all, and none carries an exemption:

| file | ticket-measured cost | how it still derives from the live repo | verified |
|---|---|---|---|
| `renderBriefingDiagramsCli.test.js` | 51.8s | two tests (lines ~88, ~113) call `renderBriefingDiagrams`/`main()` against `REAL_PROJECT_ROOT = path.join(__dirname, '..', '..')`, rendering the real `docs/diagrams/*.mmd` — "maintained sources" that grow if a diagram is added | read file directly |
| `renderBriefingBurndownCli.test.js` | 34.0s | 3 of 5 tests (own comments say "smoke test against the real repo", "no --snapshot flag means the FULL real-repo derive") call `renderBriefingBurndown(repoRoot)`/`main()` with no snapshot, walking real git log for history depth | read file directly |
| `briefingDigestLineCli.test.js` | 10.1s | 3 of 4 tests run the CLI with no snapshot or a nonexistent snapshot path against `path.join(__dirname, '..', '..')`, falling back to a real git-log derive | read file directly |
| `emitLifecycleSnapshotCli.test.js` | 4.0s | the CLI test (line 110) runs against `path.join(__dirname, '..', '..')` and asserts `parsed.walked` — a real walk of the live repo | read file directly |

Confirmed empirically, not just by inspection — ran the guard against each
file's current text:

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

And confirmed the guard's own "real tree" acceptance test
(`liveRepoDerivationGuard.test.js:99`, `findLiveRepoDerivations` over
`extension/test`) currently returns `[]` — it reads as proof the invariant
holds, but it is vacuous with respect to these four files: the growth
operation lives in `out/tools/render-briefing-*.js` /
`out/tools/briefing-digest-line.js` / the lifecycle-snapshot walker, one
hop away from the text the guard scans.

**What is NOT the finding:** the other three named files
(`blTopicStore.test.js`, `gitHistoryAdapter.test.js`,
`costHealthSidecar.test.js`) were checked and do **not** derive from the
live repo — they build their own isolated `mkTmpDir` + `git init` fixture
per test. Their cost is real subprocess overhead, not repo-size growth, so
they are correctly out of this invariant's scope; the ticket's own
"reach for" column was evidently shorthand for "spawns real git" rather
than "reads the live checkout" for these three.

**Remediation, the coder's call per the ticket's own "How" section:**
either (a) extend the guard to see through a bound call into
production-module code (the growth op is one function call away, not
present as inline text), or — the more direct fit given the ticket's own
words ("a smoke test that the real maintained diagrams still render is a
legitimate example... stays, but behind an exemption that records why") —
(b) add a recorded `BL-1038-EXEMPT:` reason to each of the real-derive
tests in these four files and extend the guard to actually reach them (so
the exemption has something to be checked against). Whichever direction is
taken, the acceptance test at `liveRepoDerivationGuard.test.js:99` must stop
passing vacuously — it should fail today if pointed at these four files,
and the parcel should make it do so honestly (fixture-converted or
exempted, never silently invisible to the scan).

This is one violated property at four sites — recorded as one bounce item
per Article 4.4/BL-590's lesson, not four.

---

## Checks completed this pass (Article 4.4 — full inventory, not first-failure)

- **Dependency-gate (hard gate, BL-259):** `node out/tools/dependency-gate.js`
  run both scoped to this parcel's 13 changed files and full-repo. Reports
  one pre-existing cycle: `telegram-front-desk-bot.ts →
  telegramCursorOperatorExec.ts → telegramCursorOperatorLiveness.ts`
  ("acyclic"). Verified via `git show <merge-base>:extension/src/tools/
  telegram-front-desk-bot.ts` that both imports already existed **before**
  this parcel's first commit — src/tools/telegram-front-desk-bot.ts is
  untouched by this parcel (only its test file changed). Already tracked as
  `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`.
  Not this parcel's defect; not a bounce reason here.
- **Co-change report (informational, BL-255):** run over all 13 changed
  files. Flagged pairs (e.g. `epicMakeTopBridge.test.js` ×
  `bridgeServer.ts`/`makeTopPrioritySafety.ts`) reflect pre-existing,
  legitimate bridge-test/bridge-server coupling — nothing this parcel
  introduces or that looks suspicious.
- **Invariant 2** (exemption honoured only with a recorded reason): encoded
  non-vacuously in `bl1038PinnedFixture.property.test.js` (200-run property,
  including the newline-trap case) and example-tested in
  `liveRepoDerivationGuard.test.js`. Sound.
- **Invariant 3** (test_count never falls, nothing deleted/skipped/excluded):
  correctly NOT encoded as a property (stated non-encodability reason in
  `bl1038PinnedFixture.property.test.js`'s header — quantifies over
  successive suite runs, not a pure module). Hand-verified this pass: `git
  diff` over the parcel shows no `.skip`/`.only`, no vitest config/exclude
  glob change, no test file deletion.
- **Property coverage of touched pure modules:** `resolveScriptClosure`
  (pinnedRepoFixture.js) and the guard's own pure functions are covered;
  non-vacuity is demonstrated in-file rather than merely claimed.
- `npm run compile` — green (recompiled `out/` before running the gates
  above; it was stale from a prior HEAD).

## What is NOT the problem — do not change

- The eight converted `*Bridge`/`commitIntegrityRunner`/
  `telegramFrontDeskBotCli` tests' switch to `copyScriptClosure` — correct,
  keep as-is.
- `liveRepoDerivationGuard.js`'s self-exemption list and its exemption-regex
  newline-trap fix — correct, keep as-is.
- The acceptance feature scenarios (`BL-1038-...-01..06`) — all structural,
  none need rewriting; they will simply have something real to exercise once
  D1 is closed.

*Recorded via `record-bounce.js --by architect` (BL-635).*
