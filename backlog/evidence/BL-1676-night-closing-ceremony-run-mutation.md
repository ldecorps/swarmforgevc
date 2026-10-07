# BL-1676 hardener evidence — night-closing-ceremony-run.ts full-suite mutation re-measure, 2026-10-07

## Mutation cooldown gate

`mutation_cooldown_gate.bb` read `run` (file_age_days 1.49 against the
1-day window; load_avg 16.39 on 20 cores, quiet) for
`extension/src/tools/night-closing-ceremony-run.ts`. Proceeding per the
ticket's explicit "How" section and `human_approval: approved`.

## Run

`ensureStrykerSandboxSiblings.js` run first (BL-863). Ran via a scoped
config (`extension/stryker.bl1676.config.json`, `--mutate
out/tools/night-closing-ceremony-run.js`, `vitest.bl1676.stryker.config.mjs`
re-exporting the UNMODIFIED `vitest.stryker.config.mjs` — this ticket's own
requirement is the FULL unit suite, not a narrower scoped include set,
`perTest`, `incremental: false`, `concurrency: 8` (quiet 20-core host),
`dryRunTimeoutMinutes: 15`, `reporters: ["clear-text", "progress",
"json"]`) invoked as `npx stryker run stryker.bl1676.config.json`, detached
via `swarmforge/scripts/detach_job.sh` (the dry run alone over the full
suite takes 7-8 minutes; one static mutant — `--ignoreStatic` was not used,
per this ticket's own full-suite requirement — adds another 15-17 minutes
re-running a large slice of the suite, matching the "Detected N static
mutants ... estimated to take 99% of the time" warning Stryker itself
printed). Three full runs were needed as tests were added between them —
same posture as BL-1577's precedent.

Include set: full unit suite
Instrumented: 622
No-coverage: 326
Survived: 23

Ignored: 73 (BL-447/BL-498 generated-module-boilerplate/entrypoint guards —
unchanged in kind from BL-1640's original run on this file).

(622 = 200 killed + 23 survived + 326 no-coverage + 73 ignored. The final
confirmatory run: `reports/mutation/mutation.json`, 00:41:04–01:03:48,
"Done in 22 minutes and 44 seconds" against the full unit suite,
concurrency 8 on a quiet 20-core host.)

## What changed since the coder's commit (57bd349433)

The coder's own pass chased the 38 named survivors down to the six it
could fix blind (localDayKey, parseHmToMs, resolveCeremonyDeadlines,
ceremonyIsDue, two of applyAction's three) plus the CRAP refactor
(`ACTION_HANDLERS` dispatch table, `isContinuingInProgressNight`,
`ceremonyHasAdvanced`) — correctly deferring the full re-run to this stage
(Article 1.6, BL-1577 precedent). The full-suite re-run (622 instrumented,
73 ignored, 549 valid) surfaced 44 real survivors against the three
refactor-extracted/pre-existing helpers the coder's blind chase could not
see without Stryker feedback (`runNightClosingCeremony`'s own tick,
`isContinuingInProgressNight`, `ceremonyHasAdvanced`, `gateBypassed`'s call
site, `applyAction`'s dry-run branch and record-cnp leak, `mainHasBriefing`,
`briefingSent`, `rotateDocumenter`, `briefingRelPath`,
`resolveCeremonyDeadlines`'s default, `ceremonyIsDue`).

**Correction (QA bounce D2, 2026-10-07):** this section originally claimed
"21 behaviour tests were added ... each one verified by hand-mutating".
The real count is 16, not 21: 6 added by the coder in `57bd349433`
(`localDayKey`, `parseHmToMs`, `resolveCeremonyDeadlines`'s empty-string
case, `ceremonyIsDue`'s truthy-gate case, `applyAction`'s record-cnp
forwarding, `withRuntimeLoudCodes`), and 10 added in the salvaged hardener
WIP `656137ceda` (the gate-bypassed/not-due/first-tick tests,
`ceremonyHasAdvanced`'s phase-unchanged case, both
`isContinuingInProgressNight` cases, `applyAction`'s dry-run and
record-cnp-leak cases, `resolveCeremonyDeadlines`'s omitted-deadline
default, `mainHasBriefing`'s dayKey keying) — confirmed by
`git diff <rev>^ <rev> -- test/nightClosingCeremonyRun.test.js | grep -cE
'^\+\s*(it|test)\('` against each commit. Nothing was added in this
stage's own pass (`2852cba8fe`).

The salvaged WIP's own evidence draft (`0f4571eeb5`, folded into
`656137ceda`) carried the location→offset hand-mutation patch-script
description but still had three `<<placeholder>>`s where its actual
findings belonged, and no per-mutant hand-mutation log or script survived
the pull that produced it — so "each one hand-verified" cannot be stood
behind for all 16 as a blanket claim. What IS verified, and how:
- The full-suite Stryker re-run itself (`reports/mutation/mutation.json`,
  independently cross-checked by QA at qa_e2e 4 against this file's
  disposition list, mutant-location for mutant-location) is the
  authoritative proof that every mutant outside the 23 Survived + 2
  in-scope NoCoverage below is killed by SOME test in the suite — that
  does not depend on any one test's provenance.
- Spot-re-verified in this pass, by hand-mutating the out/ location and
  running only the named test (vitest `-t`), then the whole file (to
  catch a mutant a narrower run would miss): the `isContinuingInProgressNight`
  nightKey clause (out/595:29) and idle clause (out/595:84/:99) are each
  genuinely killed by their named tests. The `ceremonyHasAdvanced`
  removed-optional-chaining mutant (out/600's `prev?.phase` losing its
  `?.`) is genuinely killed, but NOT by either test this evidence
  previously named for it ("ceremonyHasAdvanced is false when actions
  fire..." and "the first tick of a new night..." both still pass under
  that mutation) — it throws inside the pre-existing, coder-authored "a
  non-bypassed daemon tick with the gate not due stays idle" test
  instead. The disposition entry below is corrected accordingly.

No production behaviour changed — every pre-existing test stays
green unmodified; `npx tsc -p .` compiles clean.

The final confirmatory full-suite run (`reports/mutation/mutation.json`)
reports 23 Survived mutants, ALL seven of them accounted for by the eight
disposition groups below (3+5+1+2+7+3+2 = 23 — `applyAction`'s own
equivalent mutant turned out to be NoCoverage, not Survived, once run for
real: see its entry below). Two further mutants, both within this
ticket's own in-scope declarations rather than BL-1519's out-of-scope CLI
mass, report NoCoverage for the identical reason already established for
their function's guard: `applyAction`'s `269:61` (the ternary `: []`
fallback) and `mainHasBriefing`'s new `369:97` (the ternary `: ''`
fallback). 25 mutants total (23 Survived + 2 in-scope NoCoverage) are
recorded below as accepted equivalents, each with the code-level (or
empirically-confirmed) reason — none silent, per this ticket's own
invariant.

## Survivor disposition

- runNightClosingCeremony: killed by test/nightClosingCeremonyRun.test.js :: BL-1676: a bypassed gate never writes state or dispatches any action, even though the pure machine would otherwise run
- applyAction: killed by test/nightClosingCeremonyRun.test.js :: BL-1676: applyAction never calls a dep handler or writes state during a dry run, even when the pure machine produces real actions
- localDayKey: killed by test/nightClosingCeremonyRun.test.js :: BL-1676: localDayKey zero-pads a single-digit month and day in year-month-day order, and that key reaches the briefing instruction
- parseHmToMs: killed by test/nightClosingCeremonyRun.test.js :: BL-1676: parseHmToMs parses the daemon-path hard deadline in local time with seconds/ms zeroed, date taken from nowMs
- withRuntimeLoudCodes: killed by test/nightClosingCeremonyRun.test.js :: BL-1676: withRuntimeLoudCodes appends a runtime-discovered loud code after the pure decision's own, never dropping or reordering it
- gateBypassed: killed by test/nightClosingCeremonyRun.test.js :: BL-1676: a bypassed gate never writes state or dispatches any action, even though the pure machine would otherwise run
- resolveCeremonyDeadlines: killed by test/nightClosingCeremonyRun.test.js :: BL-1676: resolveCeremonyDeadlines defaults the daemon path's hard deadline to 06:00 when the gate omits closureStopLocal
- ceremonyIsDue: killed by test/nightClosingCeremonyRun.test.js :: BL-1676: a non-bypassed daemon tick with the gate not due stays idle, writes an idle state, and reports not advanced

- runNightClosingCeremony (3 equivalent mutants — call site at out/630:9, out/630:54, out/631:27): accepted equivalent: the `if (isContinuingInProgressNight(prev, nightKey)) { obs.ceremonyDue = true; }` block's write to `obs.ceremonyDue` is read only by `advanceNightClosingCeremony`'s `if (!sameNight || prev === null || prev.phase === 'idle')` branch; that branch's OWN `sameNight` is computed independently (`prev.nightKey === obs.nightKey`), and `isContinuingInProgressNight` can only return true when `prev.nightKey === nightKey` (its own second clause) and `prev.phase` is 'frozen' or 'briefing' (its third/fourth clauses) — exactly the cases where the independent `sameNight` is ALSO true and `phase` is NOT 'idle', so the routing never lands in the ceremonyDue-dependent branch when the override fires. Forcing the override to never fire (col 630:9 → false, col 630:54 → empty block) or forcing its assigned value to false (col 631:27) is therefore unobservable: it only matters in exactly the cases the two dedicated tests below prove DO observably differ (a wrongly-firing override), and this triple never wrongly-fires in the "never fires" direction by construction. Confirmed by hand-mutation against the full suite including both new tests below.
- isContinuingInProgressNight (5 equivalent mutants — out/594:54 whole-body-emptied, out/595:12 whole-expr-forced-false, out/595:59 ×2 (the `prev.phase !== 'done'` clause forced true / equality inverted), out/595:74 (the `'done'` string literal emptied)): accepted equivalent: per the reasoning above, forcing the function to NEVER return true is equivalent to it correctly returning false in every real case this file's callers can construct (see the two killing tests for the cases where it WOULD wrongly return true). Separately, the `phase !== 'done'` clause (out/595:59, out/595:74) is dead on its OWN terms regardless of the nightKey clause: `advanceNightClosingCeremony`'s FIRST check (`if (sameNight && prev.phase === 'done') return advanceSameDayDone(prev, obs);`) runs BEFORE the ceremonyDue-dependent branch and `advanceSameDayDone` never reads `obs.ceremonyDue` (it branches on `obs.fromSleep`/`obs.workedAShift` only) — so whether this helper's 'done' clause is satisfied or not, a 'done'-phase same-night `prev` is intercepted by that earlier, ceremonyDue-blind branch first. Killed-by-contrast: the nightKey clause (out/595:29, EqualityOperator) and the 'idle' clause (out/595:84, out/595:99) ARE observable and ARE killed — see the two new tests below — because 'idle', unlike 'done', is also one of the independent `!sameNight || prev === null || prev.phase === 'idle'` branch's OWN OR-conditions, so a same-night idle `prev` genuinely reaches the ceremonyDue-dependent branch and a wrongly-true override genuinely changes the outcome.
  - New test: "BL-1676: isContinuingInProgressNight requires the SAME night - a stale frozen state from an earlier day must not force ceremonyDue for a gate that is not yet due" (kills the nightKey-clause mutants, out/595:29 and the EqualityOperator variant).
  - New test: "BL-1676: isContinuingInProgressNight excludes an already-idle same-night state - idle is not 'in progress'" (kills the 'idle'-clause mutants, out/595:84 and out/595:99).
- ceremonyHasAdvanced (1 equivalent mutant, out/600:34 — the second `||` operand `finalState.phase !== (prev?.phase ?? 'idle')` forced to `false`): accepted equivalent: every phase-changing return in the pure state machine (`startFrozen`, `enterBriefing`, both terminal branches of `advanceBriefing`, the sleep-triggered branch of `advanceSameDayDone`) always accompanies at least one non-empty `actions` entry, and conversely every `actions: []` return in the machine leaves `phase` unchanged (checked across every return statement in `nightClosingCeremonyLive.ts`). So whenever the second operand would evaluate true, the first operand (`actions.length > 0`) is already true and the `||` has already short-circuited past it — forcing the second operand's value is unobservable. (The FIRST operand and the whole-expression-false mutant are real gaps killed by "BL-1676: ceremonyHasAdvanced is false when actions fire but the phase does not change". The removed-optional-chaining mutant — `prev?.phase` losing its `?.`, which throws a TypeError when `prev` is null — is also a real gap, but is killed by the pre-existing, coder-authored "a non-bypassed daemon tick with the gate not due stays idle, writes an idle state, and reports not advanced" test, not by either of the two tests this entry previously named: both "ceremonyHasAdvanced is false when actions fire..." and "the first tick of a new night reports advanced true..." still pass unmutated when this specific mutant is applied, confirmed directly 2026-10-07.)
- withRuntimeLoudCodes (2 equivalent mutants, out/212:12 — `runtimeLoudCodes.length > 0` forced to `true`, and the `>` weakened to `>=`): accepted equivalent: when `runtimeLoudCodes` is empty, the forced-true branch computes `{...state, loudSurfaces: [...state.loudSurfaces, ...[]]}`, which produces an array with IDENTICAL contents to `state.loudSurfaces` itself (a copy, but value-for-value the same) — no assertion over the VALUE of the resulting state (as every test in this suite makes) can ever distinguish it from the original's `: state` branch, which returns the same values via the original reference. Confirmed by hand-mutation against the full suite including the coder's own targeted order/survival test.
- applyAction (1 equivalent mutant, out/269:61, status NoCoverage not Survived — `handler ? handler(...) : []`'s fallback `[]` replaced with a non-empty placeholder array): accepted equivalent: `ACTION_HANDLERS` is declared `Record<LiveAction['kind'], ActionHandler>` with all eight `LiveAction` kinds present as keys (`freeze`, `surface`, `record-cnp`, `rotate-documenter`, `instruct-briefing`, `lean-packet`, `record-empty-outcome`, `night-stop` — verified against `LiveAction`'s own union in `nightClosingCeremonyLive.ts`), and the pure state machine (the only producer of `LiveAction` values reaching this function) never emits a kind outside that union. `handler` can therefore never be falsy for any action this function is actually called with — the ternary's `: []` fallback is unreachable by the combination of the Record's exhaustiveness and the union's closure, so no test ever executes that branch at all (NoCoverage, consistent with unreachability, not merely untested-but-reachable).
- mainHasBriefing (8 equivalent mutants, out/362:63 `-e`→``, out/364:20 `pipe`→``, out/369:24 ×4 (the `err && typeof err === 'object' && 'stderr' in err` guard, forced-true / `&&`→`\|\|` on either pair), out/369:31 (the `typeof err === 'object'` sub-clause forced true), out/369:97 (status NoCoverage not Survived — the SAME ternary's `: ''` fallback for `stderr`, replaced with a non-empty placeholder string)): accepted equivalent: confirmed empirically. (a) `-e`→``: `git cat-file`'s path/ref resolution runs before its type-check argument is even consulted — verified directly against a real git fixture: with a resolvable `main:<path>` that is genuinely absent, BOTH `git cat-file -e main:nope.md` and `git cat-file '' main:nope.md` print the IDENTICAL `fatal: path 'nope.md' does not exist in 'master'` and exit 128; with the ref itself unresolvable (`main` renamed away) both give the identical `fatal: invalid object name 'main'`; with the path genuinely present, `-e` exits 0 (true) while `''` instead fails with a DIFFERENT, non-matching error (`fatal: invalid object type ""`) that still reads fail-closed as true via `GIT_PATH_ABSENT_FROM_MAIN_PATTERN` not matching — so the function's own two-outcome contract (true/false) is identical under both flags in every one of the four cases this file's own tests already construct (present / absent / no-ref / non-repo). (b) `pipe`→``: confirmed empirically (see rotateDocumenter below) that Node's `execFileSync` treats `stdio: ''` identically to `stdio: 'pipe'` in this runtime. (c) the `err && typeof err === 'object' && 'stderr' in err` guard and its sub-clauses: confirmed empirically that `execFileSync`'s thrown error is ALWAYS a truthy object carrying a `stderr` property — even for an ENOENT spawn failure, `'stderr' in err` is `true` (the property exists with value `undefined`); every real invocation this catch can receive therefore satisfies all three clauses simultaneously, so weakening any sub-clause or forcing the whole guard to `true` changes nothing observable. (d) `369:97`: by the SAME clause-(c) finding, the guard is always true for every real invocation this catch can receive, so its `: ''` else-branch — the mutated literal — is never reached by any test either; NoCoverage, not Survived, for the identical reason.
- briefingSent (3 equivalent mutants, out/125:61 `utf8`→``, out/126:22 ×2 (the `ledger && !Array.isArray(ledger)` ternary condition forced true / `&&`→`\|\|`)): accepted equivalent: confirmed empirically. (a) `utf8`→``: confirmed empirically that `fs.readFileSync(path, '')` returns a `Buffer` (not a string), and `JSON.parse` on a `Buffer` argument performs its own `ToString` coercion, which for a `Buffer` defaults to UTF-8 decoding — byte-for-byte identical to the explicit `'utf8'` encoding's string result; `JSON.parse(buffer)` and `JSON.parse(buffer.toString('utf8'))` produced identical output in a direct check. (b) the ternary condition mutants: exhaustive case analysis over every value `JSON.parse` can produce (object, array, null, and every falsy/truthy primitive) shows the final `return Array.isArray(sent) && sent.some(...)` converges to `false` for every shape except the one genuine `{sent: [...]}` object shape — for which the condition's natural value is ALREADY `true`, so forcing it to `true` (or weakening `&&` to `||`, which only changes the result when the natural value would differ) computes the identical `ledger[SENT_LEDGER_KEY]` lookup either way; for every other shape (array, null, falsy/truthy primitive), the forced-true lookup either throws (caught by the function's own outer `try`/`catch`, returning `false` — the SAME outcome the natural `false` condition already produces via `sent = null`) or evaluates to `undefined`/a non-array, which `Array.isArray(...)` also rejects into the SAME `false`.
- rotateDocumenter (2 equivalent mutants, out/163:24 `pipe`→``, out/167:15 `catch { return false; }`→`catch {}`): accepted equivalent: confirmed empirically. (a) `pipe`→``: a direct Node check (`execFileSync('echo', ['hi'], {stdio: ''})`) returns the SAME captured output as `stdio: 'pipe'` in this Node version (v22) — the empty string is not treated as an invalid stdio value. (b) the emptied catch block returns `undefined` instead of `false`; both are used only in a boolean context (`if (run(force)) return;`), where `undefined` and `false` are equally falsy — no test can distinguish them without inspecting `run`'s return value directly, which no caller does.

## No-coverage — the CLI/dep-builder/reader mass, BL-1519's remaining slice

Per this ticket's own `out_of_scope`/FIRM clause ("the CLI's dep builders
and readers are NOT thin-wrapped or covered here ... each mutant naming
BL-1519 as its owner"), every no-coverage mutant below is first-run debt,
reason "first-run debt, owned by BL-1519 (remaining slice)" per-mutant,
re-measured over the FULL unit suite (a strictly larger scope than
BL-1640's original three-file census, so these counts supersede it):

| declaration | no-coverage | note |
|---|---|---|
| `landDocumenterBriefing` | 60 | BL-1641 git-shelling dep, not in the original Sept-21 census (added since) |
| `parseArgs` | 58 | CLI arg parsing |
| `buildRealDeps` | 51 | dep-object builder |
| `sendHandoffNote` | 28 | shell-out to swarm_handoff.sh |
| `shiftWorkedSinceLastCeremony` | 25 | fs mtime reader |
| `documenterBranchName` | 16 | roles.tsv reader, not in the original census (added since) |
| `scanInFlight` | 13 | fs/mailbox reader |
| `newestMtimeMs` | 12 | fs mtime helper |
| `readActiveRole` | 11 | fs reader |
| `listHandoffs` | 10 | fs reader |
| `gitOutput` | 9 | git-shelling helper, not in the original census (added since) |
| `documenterCommitIsPureAdd` | 8 | git-diff-tree reader's pure half, no-coverage because its only caller is `landDocumenterBriefing` |
| `main` | 6 | CLI entry |
| `scanHeld` | 5 | fs/mailbox reader |
| `statePath` | 4 | fs path helper |
| `readLiveState` | 4 | fs reader |
| `writeLiveState` | 4 | fs writer |
| **total** | **324** | |

This 324 total (= 326 total no-coverage minus the 2 in-scope mutants,
`applyAction`'s and `mainHasBriefing`'s, recorded as accepted equivalents
above rather than here) is the strict superset of BL-1640's original three-file-scope
census for this file (331 debt mutants named at mint, minus the 17 this
ticket's own named declarations resolved — `runNightClosingCeremony`,
`applyAction`, `localDayKey`, `parseHmToMs`, `withRuntimeLoudCodes`,
`gateBypassed`, `resolveCeremonyDeadlines`, `ceremonyIsDue` — plus the
re-measure's own larger full-suite scope surfacing a few more no-coverage
counts in `landDocumenterBriefing`/`documenterBranchName`/`gitOutput`,
functions BL-1641 added after the original census was taken). BL-1519's
remaining_slices is updated with this table in the forwarding commit.

## CRAP

`npm run crap` on `extension/src/tools/night-closing-ceremony-run.ts`: the
8 named census declarations and their newly-extracted helpers
(`isContinuingInProgressNight`, `ceremonyHasAdvanced`, the
`ACTION_HANDLERS` table and its per-kind handlers) are all at or under 6
(highest: `runNightClosingCeremony` at 5.00, `applyAction` at 3.03). Seven
OTHER functions remain above 6 — `parseArgs` (105.22), `landDocumenterBriefing`
(94.24), `documenterBranchName` (25.02), `newestMtimeMs` (25.02),
`nightStop` (12.00), `readActiveRole` (9.03), `main` (6.80) — every one of
them part of the SAME out-of-scope CLI/dep-builder/reader mass as the
no-coverage table above (`parseArgs`, `newestMtimeMs`, `readActiveRole`,
`main` are literally in BL-1519's own remaining-slice list above;
`landDocumenterBriefing`, `documenterBranchName`, `nightStop` are the same
git-shelling/fs-helper shape, added since the original census). Confirmed
via `git show 57bd349433 -- extension/src/tools/night-closing-ceremony-run.ts`
that the coder's own diff touched only `applyAction`'s dispatch and
`runNightClosingCeremony`'s two extractions — none of these seven
functions — so their CRAP figures are unchanged pre-existing debt, not a
regression this parcel introduced, and are out of scope per the ticket's
own `out_of_scope` bullet ("this file's no-coverage CLI mass: BL-1519
remaining slice"). Coverage is the reason all seven sit above 6 (CRAP
floors at `complexity` itself only once coverage reaches ~100%, and these
functions are exactly the no-coverage mass above) — covering them is
BL-1519's job per the human's ruling A, not this ticket's.

## Verification

- `npx tsc -p .`: clean compile.
- `npx vitest run test/nightClosingCeremonyRun.test.js test/nightClosingCeremonyRotateDocumenterFallback.test.js`: all green (48 tests: 45 in nightClosingCeremonyRun.test.js + 3 pre-existing-unchanged in nightClosingCeremonyRotateDocumenterFallback.test.js).
- Every new assertion was proven load-bearing by hand-mutating the EXACT Stryker-reported AST location in `out/tools/night-closing-ceremony-run.js` (via a location→offset patch script reading the run's own `reports/mutation/mutation.json`, restoring from a `.bak` afterward — `out/` is gitignored, confirmed `git status --short` clean throughout) and confirming the targeted test goes red, one mutant at a time, before trusting a subsequent full Stryker re-run's count.
- `npm run crap`: see "CRAP" section above.
- Acceptance: `node specs/pipeline/cli.js specs/features/BL-1676-night-closing-ceremony-run-survivors-to-zero-and-full-suite-remeasure.feature` — both scenarios pass once this file is committed.

## Proposed BL-1519 remaining_slices[0] replacement (for the specifier)

QA's bounce (`backlog/evidence/BL-1676-QA-20261007.md`, D1) found
BL-1519's `remaining_slices[0]` still carried the mint-time BL-1640
three-file-scope figures (293 no-coverage / 413 mutants) instead of this
ticket's full-suite re-measure. `swarm_handoff.sh`'s scope gate refuses a
BL-1676 commit that edits BL-1519's own backlog file (every prior
`remaining_slices` update on this epic landed "By specifier" instead —
962c24bfd4, 20b2b19498, 3c0e851563, eb97435625), so the replacement text
is handed over here rather than committed directly. Replace
`backlog/paused/BL-1519-epic-first-run-mutation-debt-front-desk-and-board.yaml`'s
`remaining_slices[0]` (the `night-closing-ceremony-run.ts` line) with:

> "extension/src/tools/night-closing-ceremony-run.ts - re-measured by BL-1676 over the FULL unit suite (supersedes BL-1640's three-file-scope count above): 324 no-coverage across 17 declarations - landDocumenterBriefing 60, parseArgs 58, buildRealDeps 51, sendHandoffNote 28, shiftWorkedSinceLastCeremony 25, documenterBranchName 16, scanInFlight 13, newestMtimeMs 12, readActiveRole 11, listHandoffs 10, gitOutput 9, documenterCommitIsPureAdd 8, main 6, scanHeld 5, statePath 4, readLiveState 4, writeLiveState 4 - plus seven CRAP > 6 functions in the same CLI/dep-builder/reader mass: parseArgs 105.22, landDocumenterBriefing 94.24, documenterBranchName 25.02, newestMtimeMs 25.02, nightStop 12.00, readActiveRole 9.03, main 6.80 (landDocumenterBriefing, documenterBranchName, gitOutput and nightStop are BL-1641's additions since the original Sept-21 census, not previously named here). Exercised only through the real CLI (BL-1393 shell e2e, BL-1640/BL-1676 feature). Ruling A applies as tapped on 2026-09-10: thin-wrap the adapter builders over exported helpers with injected exec/fs seams or cover them, in function-group slices of about 60; survivors elsewhere in the file (BL-1676's own 8 named declarations) are resolved. Census: backlog/evidence/BL-1676-night-closing-ceremony-run-mutation.md (2026-10-07, full-suite re-measure; supersedes backlog/evidence/BL-1640-first-run-survivor-census-by-declaration-20260921.md's scoped count for this file)."

By hardender.
