# BL-1667 hardener: first-ever scoped Stryker mutation run on multiBranchParserCoverageCheck.js — survivor census

## Scope of this run

`extension/src/tools/multiBranchParserCoverageCheck.ts` had never been
mutation-tested before (BL-755, the ticket that introduced this file, is
in `backlog/done` with no mutation evidence on file). Ran a ticket-scoped
Stryker pass (`vitest.bl1667.stryker.config.mjs`, deleted before
forwarding per the standing rule against editing the shared
`vitest.config.mjs`; `stryker.config.json` pointed at it for the run only
and was restored) — `--mutate out/tools/multiBranchParserCoverageCheck.js`
— to route around an unrelated interference: Stryker's own dry run (which
runs the WHOLE shared unit suite for `coverageAnalysis: perTest`) makes
`extension/test/bl1652HandoffdRespawnReadingsWiring.test.js`'s
"role-lane-running?: a role-info with no matching lane process reads
false" case fail deterministically (2/2 reproductions), while it passes
clean in isolation and in three separate full `npm test` runs the same
session — a Stryker-dry-run-environment artifact, unrelated to this
ticket's file, not investigated further here.

## What was chased in-pass

The coder's own diff (`7630980c04`) touched only `MARKER_CLASS`,
`escapeRegExp`, and `armExercisedByTests` (out/ lines 26-32). One real
survivor sat there: `escapeRegExp`'s replacement string mutated from
`'\\$&'` to `""` survived the whole existing battery, because every
existing arm marker in every test ("double-quoted", "c--a", "a00",
"unquoted") happens to already sit inside `MARKER_CLASS`'s own alphabet
(`[a-z0-9-]`), so escaping was a no-op for all of them. Confirmed NOT
equivalent: `extractCondArms`/`extractTsArms` draw a marker from
`/"([^"]+)"/` and `/return\s+['"]([^'"]+)['"]/` — ANY non-quote
character, never constrained to `MARKER_CLASS` — so a real marker
containing a regex metacharacter (a `.`, ordinary in a version string or
path fragment) needs `escapeRegExp` to be treated as literal text.
Killed with a new unit case (`armExercisedByTests treats a marker
containing a regex metacharacter as a literal, never as regex syntax`),
verified by hand: an unescaped `.` would match `aXb` for marker `a.b`;
the real function correctly returns `false`. Re-run confirmed: survived
105→106 killed, the specific line-28 survivor gone.

## First-run debt handed over (unowned, not this ticket's)

Every other survived/no-coverage mutant sits in `extractCondParsers`,
`extractCondArms`, `extractTsMultiArmParsers`, `extractTsArms`,
`sliceBalancedBlock`, and `assessMultiBranchParserCoverage`'s own no-op
branch (`parsers.length === 0`) — none touched by this ticket's diff, and
the ticket's own constraint is explicit: "No change to extractCondParsers
or to what a marker is." `npm run crap` (real coverage, 635/10821 unit
tests green) independently flags three of these same functions over the
CRAP<=6 threshold: `extractMultiBranchParsers` (complexity=5,
coverage=15%, CRAP=20.15), `extractTsMultiArmParsers` (complexity=7,
coverage=83%, CRAP=7.26), `assessMultiBranchParserCoverage`
(complexity=7, coverage=100%, CRAP=7.00) — all pre-existing, none
regressed by this parcel (the coder's diff never touched their bodies).

Scoped run totals: 216 mutants, 106 killed, 1 timeout, 85 survived, 21 no
coverage (post-fix). Full per-mutant list (kind, out/ line:col):

```
[NoCoverage] MethodExpression out/tools/multiBranchParserCoverageCheck.js:46:60
[NoCoverage] ArithmeticOperator out/tools/multiBranchParserCoverageCheck.js:46:79 (x2)
[NoCoverage] BlockStatement out/tools/multiBranchParserCoverageCheck.js:48:26
[NoCoverage] BlockStatement out/tools/multiBranchParserCoverageCheck.js:79:28
[NoCoverage] BlockStatement out/tools/multiBranchParserCoverageCheck.js:84:24
[NoCoverage] MethodExpression out/tools/multiBranchParserCoverageCheck.js:109:12
[NoCoverage] BlockStatement out/tools/multiBranchParserCoverageCheck.js:118:43
[NoCoverage] ArrayDeclaration out/tools/multiBranchParserCoverageCheck.js:119:17
[NoCoverage] BlockStatement out/tools/multiBranchParserCoverageCheck.js:120:31
[NoCoverage] StringLiteral out/tools/multiBranchParserCoverageCheck.js:121:53
[NoCoverage] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:122:13 (x2)
[NoCoverage] LogicalOperator out/tools/multiBranchParserCoverageCheck.js:122:13
[NoCoverage] Regex out/tools/multiBranchParserCoverageCheck.js:122:13
[NoCoverage] Regex out/tools/multiBranchParserCoverageCheck.js:122:41
[NoCoverage] BlockStatement out/tools/multiBranchParserCoverageCheck.js:122:68
[NoCoverage] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:125:18 (x2)
[NoCoverage] Regex out/tools/multiBranchParserCoverageCheck.js:125:18
[NoCoverage] BlockStatement out/tools/multiBranchParserCoverageCheck.js:125:57
[Survived] Regex out/tools/multiBranchParserCoverageCheck.js:40:20
[Survived] Regex out/tools/multiBranchParserCoverageCheck.js:45:55 (x2)
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:46:22
[Survived] MethodExpression out/tools/multiBranchParserCoverageCheck.js:46:39
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:48:13
[Survived] EqualityOperator out/tools/multiBranchParserCoverageCheck.js:48:13
[Survived] MethodExpression out/tools/multiBranchParserCoverageCheck.js:51:38
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:52:13
[Survived] MethodExpression out/tools/multiBranchParserCoverageCheck.js:60:19
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:63:13
[Survived] ArrowFunction out/tools/multiBranchParserCoverageCheck.js:63:24
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:63:31
[Survived] ObjectLiteral out/tools/multiBranchParserCoverageCheck.js:64:23
[Survived] Regex out/tools/multiBranchParserCoverageCheck.js:75:18 (x23)
[Survived] StringLiteral out/tools/multiBranchParserCoverageCheck.js:83:38
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:79:13
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:84:13
[Survived] EqualityOperator out/tools/multiBranchParserCoverageCheck.js:84:13
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:89:13
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:97:29
[Survived] EqualityOperator out/tools/multiBranchParserCoverageCheck.js:97:29 (x2)
[Survived] BlockStatement out/tools/multiBranchParserCoverageCheck.js:97:56
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:99:13 (x2)
[Survived] EqualityOperator out/tools/multiBranchParserCoverageCheck.js:99:13
[Survived] StringLiteral out/tools/multiBranchParserCoverageCheck.js:99:20
[Survived] BlockStatement out/tools/multiBranchParserCoverageCheck.js:99:25
[Survived] AssignmentOperator out/tools/multiBranchParserCoverageCheck.js:100:13
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:102:18
[Survived] StringLiteral out/tools/multiBranchParserCoverageCheck.js:102:25
[Survived] BlockStatement out/tools/multiBranchParserCoverageCheck.js:102:30
[Survived] AssignmentOperator out/tools/multiBranchParserCoverageCheck.js:103:13
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:104:17 (x2)
[Survived] EqualityOperator out/tools/multiBranchParserCoverageCheck.js:104:17
[Survived] BlockStatement out/tools/multiBranchParserCoverageCheck.js:104:30
[Survived] MethodExpression out/tools/multiBranchParserCoverageCheck.js:105:24
[Survived] ArithmeticOperator out/tools/multiBranchParserCoverageCheck.js:105:48
[Survived] Regex out/tools/multiBranchParserCoverageCheck.js:112:42
[Survived] ArrayDeclaration out/tools/multiBranchParserCoverageCheck.js:113:22
[Survived] Regex out/tools/multiBranchParserCoverageCheck.js:113:40 (x6)
[Survived] ArrowFunction out/tools/multiBranchParserCoverageCheck.js:113:73
[Survived] ArrayDeclaration out/tools/multiBranchParserCoverageCheck.js:114:28
[Survived] Regex out/tools/multiBranchParserCoverageCheck.js:114:46 (x6)
[Survived] ArrowFunction out/tools/multiBranchParserCoverageCheck.js:114:87
[Survived] ArrowFunction out/tools/multiBranchParserCoverageCheck.js:116:25
[Survived] ObjectLiteral out/tools/multiBranchParserCoverageCheck.js:116:35
[Survived] ConditionalExpression out/tools/multiBranchParserCoverageCheck.js:136:9
[Survived] BlockStatement out/tools/multiBranchParserCoverageCheck.js:136:31
[Survived] StringLiteral out/tools/multiBranchParserCoverageCheck.js:16:42
```

By hardener.
