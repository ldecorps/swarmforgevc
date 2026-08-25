# BL-1083 — hardener pass

Received from architect as `merge_and_process architect 3e280fef95` (COMPLIANT
verdict; one flagged coverage gap, not bounce-worthy, left for this stage:
`bridgeServer.ts`'s new `if (promotion.refusal)` branch in
`handlePausedPagerExpediteRoute` had zero automated test coverage).

## Coverage gap closed (architect's flag)

Added `paused-pager Expedite route refuses (409) and leaves the ticket in
paused/ when a gate says no` to `pausedPagerBridge.test.js` — drives the real
bridge server + real gate CLI fixture (`mkGitTmpWithCli`) against a ticket
with an unlanded `depends_on`, asserting the 409 body, and that the ticket
stays in `paused/` (invariant 2: never a silent no-op). Confirmed non-vacuous
by hand-mutating `if (promotion.refusal)` to `if (false)`: only this new test
failed (16/16 -> 15/16), everything else stayed green; reverted, reconfirmed
16/16.

`handlePausedPagerExpediteRoute`'s own coverage: 0% on the refusal branch
before this test (per the architect's flag), 100% after (measured against a
full, unscoped `vitest run --coverage` — a coverage run scoped to just the
touched test files undercounts shared files like `bridgeServer.ts` and
mislabels baseline debt as new fallout; re-ran unscoped before trusting any
number in this file).

## A second, same-shape gap the architect's flag didn't name

`recordExpediteDecisionAndClose`'s own refusal branch (the Telegram Expedite
verb's side of the same fix) had **no unit-level test either** — only
acceptance coverage via `bl1083PromotionGateSteps.js` (node --test, outside
`coverage/coverage-final.json`). Measured 74% coverage, CRAP 4.27 (already
under the 6 threshold, so not gate-failing, but not the 100% Article 4.1
asks for). Added two tests to `telegramFrontDeskBotCore.test.js`:

- refusal reported, Approvals topic told the gate+reason, no build dispatched,
  ask still closed, approval still committed
- approval commit ordering: `commitExpediteWrites` still runs on a refusal,
  same durability guarantee BL-490-VIOLATION requires for every other outcome

**Found on the way**: `expediteFixtureAdapters` (the shared fixture builder
`recordExpediteDecisionAndClose`'s own test suite already used) did not
thread a `notifyApprovalsTopic` override at all — an override passed to it
was silently discarded, so the real adapter's `?.()` call-site no-op'd and
the refusal test's `notified` assertion failed with `[]` instead of the
expected notice. Same shape as the standing rule "A shared fixture builder
silently DROPS an override it does not thread" (BL-582, 2026-08-22). Fixed
by threading it with the same default-no-op posture as its siblings.
Confirmed non-vacuous the same way as above: reverted the refusal branch to
`if (false && promotion.refusal)`, only the new test failed, everything else
stayed green.

`recordExpediteDecisionAndClose` coverage after: 100%, CRAP 4.00 (unscoped
coverage run).

## CRAP — no regression, differential check against `main`

`backlogWriter.ts`: max 6.00 (`parseGateVerdict`, exactly at threshold, not
over). `bridgeServer.ts` / `telegram-front-desk-bot.ts` /
`telegramFrontDeskBotCore.ts`: 22 functions sit above CRAP 6 in these three
large shared files, but **none of them are functions this ticket touched** —
cross-checked against the diff's own hunks (`git diff main..3e280fef95`)
which name exactly five spots: `handlePausedPagerExpediteRoute`,
`buildPollAdapters`, `decidePollAnswerAction` (context only, unchanged),
`normalizePromotionOutcome`/`PromotionOutcome`/`PromotionRefusal` (new), and
`recordExpediteDecisionAndClose`. All five: CRAP 2.00-4.00, well under
threshold, 100% coverage after the additions above. The 22 flagged functions
are baseline debt untouched by this diff (confirmed byte-identical
`grep "CRAP >"` output before and after this pass's test additions).

Differential complexity check (accepted hardener rule_proposal, 2026-08-19):
compared each of the five touched/new functions' complexity against `main`
(HEAD `f8326bac5`, ahead of `origin/main` per `git rev-list --left-right
--count`, so the fresher ref): `handlePausedPagerExpediteRoute` 2->2,
`buildPollAdapters` 2->2, `decidePollAnswerAction` 4->4 (unchanged — the diff
only adds new exports after it, never touches its body),
`recordExpediteDecisionAndClose` 3->4 (+1, the new refusal branch — expected,
deliberate, and the whole point of the ticket). No masked regression.

## Mutation — `backlogWriter.ts` (past BL-149 cooldown, host quiet)

`bridgeServer.ts`, `telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`
all read `skip-cooldown` from `mutation_cooldown_gate.bb` (committed within
the last 3 days) — no mutation run against them this pass, per the gate.
`promotion_gates_cli.bb` and `backlogWriter.ts` read `run`.

`backlogWriter.ts` (`out/panel/backlogWriter.js`, differential
`--mutate out/panel/backlogWriter.js --concurrency 1`, both runs detached via
`detach_job.sh` — the dry run alone is ~2m14s, well past the 2-minute
foreground ceiling): first pass 264 mutants instrumented, 195 covered-tier
(161 killed / 21 survived / 13 no-coverage), 82.56% score.

Triaged every non-killed mutant by reading the exact diff against `main` and
the consuming code, not by pattern-matching the mutator name:

**Pre-existing, outside this ticket's diff (13) — left alone**: the
`ASSIGNED_TO_LINE` regex (2, `setAssignedTo`), `markDone`'s `item?.milestone`
optional-chain and its `'utf8'` string literal (2), and the three-times-
repeated `if (!filePath) { return {moved:false}; }` shape in `parkToHold`
(BL-698) and `reinstateFromHold` (BL-698) plus `findMatchingBacklogFile`'s
`catch { continue; }` (8 more) — none of these lines are `+` lines in
`git diff main..3e280fef95`, all pre-date this ticket by weeks (BL-698,
BL-034).

**Equivalent, demonstrable from the consuming code (5) — not tested,
recorded here per BL-234**:
- `runGateCli`'s `typeof e.stdout === 'string' ? e.stdout : ''` ternary (and
  its `NoCoverage` string-literal sibling): `execFileSync` is called with
  `{ encoding: 'utf8' }`, so whenever `err.status` is 1 or 2 the child process
  ran to completion and Node decoded its stdout per that same encoding —
  `err.stdout` is guaranteed a string on that path. The `: ''` branch is
  TypeScript defensive coding against the library's own `stdout?: string |
  Buffer` type, unreachable through the real subprocess boundary this module
  deliberately never mocks (no import crosses the TS/Babashka line — the
  ticket's own architecture rule). Confirmed no OTHER path reaches this
  branch by re-reading `runGateCli`'s only call site.
- `runGateCli`'s `return { crashed: true }` (BooleanLiteral -> `false`):
  `GateCliOutcome`'s only consumer is `'crashed' in outcome` (a KEY-presence
  check, `consultPromotionGates`, its one call site) — grepped the whole file
  for `crashed`, found exactly those two occurrences. Value is never read.
  Sanity-checked live: hand-mutating to `{ crashed: false }` does not even
  type-check (`GateCliOutcome`'s `crashed` field is typed as the literal
  `true`), and `tsc`'s `noEmitOnError` default left `out/` untouched, so
  reverted with no residue.
- `parseGateVerdict`'s `return { kind: 'allow' }` (both its ObjectLiteral ->
  `{}` and StringLiteral -> `{ kind: "" }` mutants): `promoteToActive`'s only
  two checks are `verdict.kind === 'not-found'` and `verdict.kind ===
  'refuse'` — grepped the file for `'allow'` and `kind ===`, confirmed no
  third site ever discriminates on the literal `'allow'` tag. Any verdict
  object that is neither of the two explicitly-checked shapes falls through
  as ALLOW by construction, so `{}` and `{ kind: 'allow' }` are
  indistinguishable to every consumer that exists.

**Real gaps, closed with 5 new tests in `backlogWriter.test.js` (16
mutants)**:
1. `.filter(Boolean).pop()`'s `.trim()` (MethodExpression, 141:48) — no test
   exercised a padded CLI line. Added a fake-CLI test printing `"  ALLOW  "`;
   asserts `moved: true` (mutant without trim falls through to unrecognised
   and refuses).
2. The REFUSE reason's `reason.join('|')` (StringLiteral, 150:60) — no
   reason in the real gate rules contains a literal `|`, so the re-join was
   never exercised meaningfully. Added a fake-CLI test with a reason
   containing an embedded `|`; asserts it survives verbatim.
3. The unrecognised-verdict fallback's `line || '(no output)'` (3 survived
   mutants at 155:69) plus its two `NoCoverage` string-literal siblings
   (141:83's `?? ''`, 155:77's `'(no output)'` literal) — none of the
   existing "unrecognised verdict" tests actually produced BLANK stdout
   (they print `"GARBAGE"`, which is truthy and never reaches this fallback
   at all). Added a fake-CLI test that exits 0 with zero stdout; asserts the
   reason names `(no output)` — kills all 5 in one test.
4. `promoteToActive`'s `if (verdict.kind === 'not-found')` branch (3 survived
   mutants at 201:9/26/39) plus `parseGateVerdict`'s NOT_FOUND object-literal
   mutants (146:16/24, which — unlike the ALLOW pair above — DO change
   observable behavior, since `'not-found'` IS explicitly checked) — every
   existing NOT_FOUND-shaped test used a genuinely-absent ticket, so the
   early-return's own EFFECT (stopping before the paused/ lookup even runs)
   was never distinguished from "there was nothing to find anyway". Added a
   test with a REAL paused file present under the same id, but the fake CLI
   unconditionally answers NOT_FOUND; asserts the file is never touched —
   kills all 5 in one test.
5. `promoteToActive`'s post-gate `if (!filePath)` (ConditionalExpression
   210:9, survived; plus 210:20/211:16/211:25, `NoCoverage`) — never even
   reached by any existing test, because every existing ALLOW-path test uses
   a ticket whose filename and parsed `id:` field agree. The gate CLI locates
   its candidate by FILENAME GLOB (`promotion_gates_cli.bb`'s `find-in`); the
   TS mover re-locates independently by PARSED YAML ID
   (`findMatchingBacklogFile`). A file named for one id but whose own `id:`
   field names another is exactly the gap between those two lookups: the
   gate's `evaluate` never reads the requested id at all, so it can ALLOW
   such a file, but the mover's own re-lookup must still refuse to promote
   what it cannot confirm by content. Added a test with `BL-346-mismatch.yaml`
   containing `id: BL-999`; asserts nothing is promoted and nothing throws
   (the mutant, left unfixed, would call `moveBacklogFileTo(null, ...)` and
   crash on `path.basename(null)` — a genuine defensive property, not just a
   coverage checkbox).

Re-ran mutation from a clean incremental cache (`stryker-incremental.json`
removed) after adding the five tests: **34 -> 0 unaccounted-for**; every
previously-survived/no-coverage mutant in BL-1083's own diff is now either
killed or recorded above as equivalent/pre-existing. See the run's own
summary table for the final score.

## Verification

| check | result |
|---|---|
| `pausedPagerBridge.test.js` | 16/16 (was 15, +1 refusal test) |
| `backlogWriter.test.js` | 39/39 (was 34, +5 gate-parsing tests) |
| `telegramFrontDeskBotCore.test.js` | 421/421 (was 419, +2 refusal tests) |
| full extension unit suite (`vitest run --coverage`) | 8563/8563, 477/477 files |
| `bl1083PromotionGateInvariants.property.test.js` | 6/6 |
| BL-1083 acceptance feature | 5/5 |
| BL-1083 acceptance feature, BL-113 gherkin mutation (soft) | 3/3 killed |
| BL-490 / BL-721 acceptance features (regression) | 8/8, 4/4 unchanged |
| standing whole-tree guards (`test/*Guard*.test.js`, non-property) | 13 files, 125/125 |
| `promotion_gates_cli_test_runner.bb` (gate-promotion subcommand, previously
  untested at the CLI-contract level — 8 new tests added) | ALL PASS |
| CRAP (4 changed TS files, unscoped coverage) | max 6.00 (`parseGateVerdict`,
  at threshold); ticket's own 5 touched functions 2.00-4.00 |
| Stryker `backlogWriter.js` differential mutation | 34 non-killed triaged:
  13 pre-existing, 5 equivalent, 16 closed by 5 new tests |
| `promote_and_route_next.sh` / `promotion_gates_lib.bb` diff | still empty
  (untouched) |

No orphaned mutation/test processes left running (`pgrep -fl 'node --test|
stryker'` scoped to this worktree, clean before handoff).

## Handoff

Forwarded to documenter, task `BL-1083-every-promotion-path-goes-through-the-gate`.
