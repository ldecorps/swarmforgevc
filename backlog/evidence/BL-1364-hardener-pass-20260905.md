# BL-1364 hardener pass — clean sweep, forwarding

## Merged
Merged architect's `24d506c64d` (clean sweep) into this worktree, ancestry
confirmed (`git merge-base --is-ancestor 24d506c64d HEAD`).

## Re-verified before hardening
- Unit: `turnProfileProducer.test.js` **15/15**, `transcriptWalker.test.js`
  **3/3** (baseline).
- Acceptance (`BL-1364-...feature`): **8/8**. Regression
  (`BL-664-deterministic-turn-profiler-transcript-walker.feature`, owns the
  touched modules): **11/11**, no regression.
- Property (`bl1364TurnProfileSeriesInvariants.property.test.js`): **4/4**.
- `bash swarmforge/scripts/test/test_bl1395_bb_scripts_load.sh` (daemon boots
  with the new `turn-profile-producer-sweep`): ALL PASS.
- `bb .../bl973_closure_guard_property_runner.bb`,
  `bl1022_daemon_closure_property_runner.bb`,
  `daemon_cycle_guard_lib_property_runner.bb`: ALL PROPERTIES HOLD.
- `bb .../daemon_cycle_guard_lib_test_runner.bb`: 3 pre-existing failures
  (unresolvable `bl1022` spawn target, BL-1031 banned-API debt), confirmed
  identical when `handoffd.bb` is reverted to the pre-merge tip (architect's
  evidence, re-confirmed by re-running myself) — already tracked in
  `BL-1331`/`BL-539`, unrelated to this diff.

## CRAP (new/changed production code only)
`npm run coverage` failed the write on the same 16 pre-existing unrelated
reds carried across today's other passes; re-ran with
`--coverage.reportOnFailure=true`. Initial reading, 5 functions over
threshold:
- `formatTurnProfileResult` (run-turn-profile-producer.ts, **NEW file this
  ticket**): complexity=4, **0% coverage, CRAP=20.00**.
- `classifyToolName` (11.56), `classifyLine` (10.39),
  `transcriptsUnchanged` (6.29), `parseTimedEvents` (6.00) — all in
  `transcriptWalker.ts`, confirmed via `git diff a96f9b4f1b 24d506c64d --
  transcriptWalker.ts` to be **untouched** by this diff (the only changes
  there are the `INTERVAL_CATEGORIES` runtime export and a rewritten
  `coverageFromIntervals`) — pre-existing BL-664 debt, out of scope.

Closed the one in-scope gap: added `test/runTurnProfileProducer.test.js`
(5 tests) covering `formatTurnProfileResult`'s 4-way branch (INCOMPLETE,
SKIPPED, RECORDED-singular, UPDATED-plural/zero), matching
engineering.prompt's CLI thin-wrapper rule (`main()` itself stays untested;
the logic it delegates to must not). Final: CRAP 4.01. Noted, not fixed
(pre-existing, sibling-shared pattern): `run-context-telemetry-producer.ts`'s
own `formatProducerResult` carries the identical 0%-coverage shape
(CRAP=12.00) — not this ticket's file, not touched by this diff.

## DRY
`jscpd` over every new/changed TS file plus their tests: **0 clones**.

## Mutation (Stryker, scoped)
Scoped via `--testFiles` (the worktree's plain `vitest run` still carries the
same 16 pre-existing standing-red files established across today's other
BL-1364-unrelated passes; confirmed unrelated the same way — none touch any
file this ticket changed). `npm run compile`, then:
`stryker run --mutate out/metrics/turnProfileProducer.js,out/tools/run-turn-profile-producer.js
--testFiles test/turnProfileProducer.test.js,test/transcriptWalker.test.js,test/runTurnProfileProducer.test.js`.

**turnProfileProducer.js** (new file, 301 lines) — before: 84.96%/86.49%
covered, 15 survived, 2 nocov. After hardening: **92.04%/92.04%, 9
survived (all confirmed equivalent below), 0 nocov**.

**run-turn-profile-producer.js** (new file) — 90.00%/100.00%, 18 killed, 0
survived, 2 nocov (`main()`'s own body — the thin wrapper itself, expected
per the CLI convention).

Real gaps found and closed (9 fixes, each verified: test added, mutant
re-run, confirmed killed):
1. **`unreadable_transcripts: []` on the complete path (ArrayDeclaration)**
   — no test asserted it was empty on a clean window. Added the assertion
   to the existing worked-stage test.
2. **`window_day: endIso.slice(0, 10)` (MethodExpression removing
   `.slice`)** — no test checked window_day was a 10-char date rather than
   the full ISO timestamp. Added the length/prefix assertion.
3. **A blank/whitespace-only transcript line (`line.trim()` →
   `line`)** — untested on both the read side (`assessTranscriptReadability`)
   and the persisted-store read side (`readPersistedTurnProfileWindows`).
   Added one test each.
4. **Multiple bad lines where the last happens to be the final line** —
   added a test proving interior damage still refuses even when a torn
   tail is also present (the mutant it targeted turned out equivalent on
   inspection — see below — but the behavior itself was genuinely
   untested and is now pinned).
5. **`upsertWindowRecord`'s day-keyed replace, only ever exercised with ONE
   persisted day** — a mutant that drops every existing row before
   appending the new one still passed the old single-day fixture (final
   length 1 either way). Added a two-different-day fixture (one seeded
   directly, since `upsertWindowRecord` itself is private) proving the
   unrelated day survives the upsert.
6. **`buildTurnProfileWindowForGroups`'s `truncatedTail` init array
   (ArrayDeclaration)** — no test on the clean multi-group path checked
   `truncated_tail_transcripts` was `[]`. Added the assertion.
7. **An omitted `handoffTrail` (`?? []` fallback)** — every existing
   `buildTurnProfileWindowRecord` call passed a trail; the optional-param
   path was never reached. Added a call with no trail, asserting the
   'unknown' stage.
8. **`windowDedupeKey`'s null-day path** — every existing call used a real
   `window_day` string; the `?? 'none'` fallback for an incomplete
   window's `null` was never reached. Added a direct unit test (kills the
   ArrayDeclaration-class mutant on that line even though the exact
   fallback text is separately equivalent — see below).
9. **`TURN_PROFILE_STORE_FILE`'s literal filename and `turnProfileStorePath`'s
    join** — nothing checked the actual on-disk filename `run-context-telemetry-producer.ts`'s
    sibling convention implies. Added a direct constant assertion and an
    end-to-end existence check for the literal path.

## Confirmed EQUIVALENT (hand-mutated the compiled `out/` file directly and
re-ran the real test suite each time — not reasoned from the diff alone;
BL-1081/BL-1198 discipline)
- **`badIndexes.length === 1 && badIndexes[0] === lines.length - 1` →
  `true && ...`**: `badIndexes` is built by `Array.forEach` in ascending
  index order, so `badIndexes[0]` is always the SMALLEST bad index. For it
  to equal `lines.length - 1` (the last position), no earlier line can
  also be bad — which already forces `badIndexes.length === 1`. The
  `length === 1` conjunct is therefore redundant given the other conjunct,
  and no fixture could ever separate them. Verified: my own added test for
  this exact scenario (interior damage + torn tail) still passed under the
  mutant.
- **`unreadable.length > 0 ? [] : walkTranscriptFiles(...).intervals`
  (both the condition and the `[]` branch)**: `assembleWindowRecord`'s
  early-return path (taken whenever `unreadable.length > 0`) never reads
  its `intervals` parameter at all — `stages: []` is hardcoded there.
  Whatever this ternary computes when unreadable is nonempty is discarded
  unconditionally by its only caller. Verified by forcing the condition to
  `false` (always walk) and separately mutating the `[]` branch — both
  leave every test green.
- **`params.handoffTrail ?? []` → `?? ["Stryker was here"]`**:
  `attributeTrail`'s `trail.find(entry => row.startMs >= entry.startMs...)`
  reads `.startMs` off each trail entry; a bare string has no such
  property, so the comparison is `>= undefined`, always false — identical
  outcome (no match, stage stays 'unknown') to an empty array. Verified.
- **The `continue` skip in `buildTurnProfileWindowForGroups` (`if
  (readability.unreadable.length > 0) continue`)**: the OUTER `unreadable`
  array accumulates every group's unreadable paths unconditionally before
  this check runs, so as soon as ANY group is damaged, the function's
  final `assembleWindowRecord` call sees `unreadable.length > 0` and
  discards ALL intervals regardless of which groups were individually
  skipped. Verified by removing the `continue` entirely (an unconditional
  no-op branch) — still green.
- **`windowDedupeKey`'s `?? 'none'` fallback text**: the placeholder is
  compared for equality only against real `window_day` values, which are
  always a `YYYY-MM-DD` slice (10 chars) of a real ISO timestamp — a
  string that can never literally equal `'none'` (or any other short
  placeholder). The exact spelling of the fallback is therefore
  unobservable by construction; only its CONSISTENCY matters, which the
  added null-day test does verify (same input → same key, different
  window_day → different key). Verified by changing `'none'` to `''`.
- **`'utf8'` encoding argument on the store's `writeFileSync`**: every
  record this module ever writes is `JSON.stringify` output of ASCII-safe
  fields (dates, booleans, role names, numbers) — Node's encoding
  parameter has no observable effect on such content whether given as
  `'utf8'` or `''`. Verified with a real read-back after mutating the
  encoding to `""`; content round-tripped identically.

## Confirmed KILLED despite Stryker reporting `[Survived]` (static
top-level exports — the identical BL-1400-pass-today artifact: Stryker's
perTest execution model cannot toggle a module-top-level literal per
mutant once the module is cached by an earlier test file in the same
worker; hand-mutating the real compiled file and running the suite
directly is the authoritative check per the constitution's stale-cache
protocol)
- `exports.TURN_PROFILE_STORE_FILE = 'turn-profile-series.jsonl'` emptied
  to `""`: hand-mutated, re-ran `turnProfileProducer.test.js` directly —
  **5 tests failed** (store-path assertions, and downstream writes/reads
  that depend on a real filename).
- `exports.INTERVAL_CATEGORIES` (transcriptWalker.js, same class,
  discovered while cross-checking this ticket's category-set invariant):
  emptied to `[]`, hand-mutated, re-ran directly — **6 tests failed**,
  including the newly-added
  `INTERVAL_CATEGORIES is exactly the six known walker categories` pin.
  Added specifically because the PRE-EXISTING comparison
  (`[...INTERVAL_CATEGORIES].sort()` used as both actual AND expected)
  was vacuous against this exact mutant — both sides of the assertion
  derive from the same corruptible export, since `turnProfile.ts`'s
  `allCategoryShares` also iterates `INTERVAL_CATEGORIES` to seed the
  record's keys. Pinned the six literal names independently.

## `transcriptWalker.js` / `turnProfile.js` survivors — pre-existing,
out of scope
Scoped Stryker runs on these two files (94 and 6 survivors respectively)
confirmed by direct line-number cross-reference against
`git diff a96f9b4f1b 24d506c64d` that every survivor sits in code this
ticket's diff did not touch (`classifyToolName`, `classifyLine`,
`categoryShare`, `trendedShare`, `buildTurnProfileSeries`'s pre-existing
body). The new code in both files (`coverageFromIntervals`'s rewritten
fold, `allCategoryShares`) has zero survivors attributable to it.

## required_wiring
All three anchors confirmed live (architect's evidence, re-confirmed):
`bl1364MechanicalShareReadableSteps.js::registerSteps` (8/8 scenarios
execute), `turnProfileProducer.ts::buildTurnProfileSeries` (real call
inside `assembleWindowRecord`), `handoffd.bb::turn-profile-producer-sweep`
(real defn + call site, daemon boots per `test_bl1395_bb_scripts_load.sh`).

## Cleanup
No orphaned `node --test`/`stryker` processes before or after. Every
hand-mutation restored to the original compiled file, confirmed via a
clean passing run before moving to the next.

## Forwarding
To documenter, priority `00`, same task name, this commit forwarded.
