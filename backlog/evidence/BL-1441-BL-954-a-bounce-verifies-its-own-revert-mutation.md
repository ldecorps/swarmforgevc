# BL-1441 — mutation gate discharge — BL-954-a-bounce-verifies-its-own-revert

Gate: `mutation`. File set: `extension/src/metrics/bounceRevertGitAdapter.ts`,
`extension/src/quality/bounceRevertVerdict.ts`, `extension/src/tools/record-bounce.ts`
(deferred 2026-08-19, first blocked by cooldown then by the
`constitutionDocCitations` red — BL-1440, landed 2026-09-06).

## Eligibility, checked before the run

- `mutation_cooldown_gate.bb` on all three files: `DECISION: run` —
  `bounceRevertGitAdapter.ts` 9.44 days, `bounceRevertVerdict.ts` 9.44 days,
  `record-bounce.ts` 17.93 days (cooldown window 3 days). None of the three
  was touched by BL-1425 on 2026-09-05.
- Host load: `load_avg 2.05-2.62` against a busy threshold of `2.00x * 20
  cores = 40` — quiet.
- `extension/test/constitutionDocCitations.test.js`: 6/6 passing (BL-1440
  landed) — the Stryker dry run's whole-suite precondition is clear.

## Two real blockers found and fixed en route (in this parcel)

Both are prerequisites of the run itself, not of the file set under test —
recorded because they blocked every scoped Stryker invocation, not only
this one.

1. **`extension/scripts/ensureStrykerSandboxSiblings.js` had no `backlog/`
   sibling link.** `extension/test/helpers/stampOff.js`'s `findTicketYaml`
   scans `REPO_ROOT/backlog/` recursively; inside a Stryker sandbox
   `REPO_ROOT` resolves to `.stryker-tmp/` itself, which had no `backlog/`
   symlink — `ENOENT: scandir '.stryker-tmp/backlog'` failed the dry run's
   whole-suite precondition before any mutant was even instrumented. Fixed
   by adding `'backlog'` to `SIBLING_NAMES` (same shared-symlink mechanism
   as `pwa/`, `swarmforge/`, `.github/`, `docs/`, `specs/`). Masked until
   now: every prior full-suite Stryker dry run since
   `bl1356StampOffHelper.test.js` landed was blocked earlier, by cooldown or
   the citation red, before reaching this test.
2. **`test/activePoolFreshnessAudit.test.js` is a documented, standing,
   Stryker-sandbox-only red** (see the test file's own BL-1066 comment: a
   fixed `../..` walk-up from `__dirname` lands one level too shallow under
   a sandbox, by design — "exclude this file when running Stryker rather
   than 'fixing' it"). That remedy was never actually wired anywhere for a
   whole-repo dry run (`stryker.bl1439.config.json` pointed at the bare
   `vitest.config.mjs`, which does not exclude it). Fixed the same way
   `vitest.bl1081/bl1365/bl1383/bl1402.stryker.config.mjs` already do for
   their own scopes: added `vitest.bl1441.stryker.config.mjs` with
   `test.include` narrowed to the three real test files that import this
   file set by path (`quality/bounceRevertVerdict`,
   `metrics/bounceRevertGitAdapter`, `tools/record-bounce`) —
   `test/bounceRevertCheck.test.js`, `test/bounceRevertRestoration.test.js`,
   `test/recordBounceCli.test.js` — found by import path, never by a
   `record-bounce` substring grep (which also matches the unrelated
   `record-bounce-by-role-NN` scenario-label convention used throughout the
   bounce test suite). `stryker.bl1439.config.json`'s `vitest.configFile`
   repointed at the new file; its `mutate` scope (the same three compiled
   files) was already correct from BL-1439's own pass and is unchanged.

## The run

`npx stryker run stryker.bl1439.config.json` (concurrency 1, `perTest`
coverage analysis, sibling links warmed via
`ensureStrykerSandboxSiblings.js`, `npm run compile` fresh beforehand).
Dry run: 82 tests, 4s, all green. Mutation phase: 2 minutes 20 seconds.

```
Ran 5.83 tests per mutant on average.
                            | % Mutation score |          |           |            |          |          |
File                        |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files                   |  86.91 |   86.91 |      166 |         0 |         25 |        0 |        0 |
 bounceRevertGitAdapter.js  |  82.61 |   82.61 |       95 |         0 |         20 |        0 |        0 |
 bounceRevertVerdict.js     |  97.67 |   97.67 |       42 |         0 |          1 |        0 |        0 |
 record-bounce.js           |  87.88 |   87.88 |       29 |         0 |          4 |        0 |        0 |
```

Survivors: 25

## Every survivor, with the reason it stands

Grouped by root cause; every mutant location is its own line (25 total).

**A. `execFileSync(..., { stdio: ['ignore','pipe','pipe'] })`'s array,
`bounceRevertGitAdapter.ts` — a subprocess IO-channel config detail that
`encoding: 'utf8'` already makes irrelevant to any string the caller reads
back; no test (real or plausible) observes stdio plumbing directly. Near-
equivalent for this module's actual contract.**
- `out/metrics/bounceRevertGitAdapter.js:30:130` (whole array → `[]`)
- `out/metrics/bounceRevertGitAdapter.js:30:131` (`'ignore'` → `""`)
- `out/metrics/bounceRevertGitAdapter.js:30:141` (`'pipe'` → `""`)
- `out/metrics/bounceRevertGitAdapter.js:30:149` (`'pipe'` → `""`)

**B. The `catch`-path return `{ status, stdout: '' }` after a git
subprocess throws with a non-numeric `status`, `bounceRevertGitAdapter.ts`
— a genuine gap: no test drives a git failure whose thrown error carries a
non-numeric `.status`, so this branch's exact shape is unexercised.**
- `out/metrics/bounceRevertGitAdapter.js:34:20` (whole object → `{}`)
- `out/metrics/bounceRevertGitAdapter.js:34:30` (ternary → always-true)
- `out/metrics/bounceRevertGitAdapter.js:34:30` (ternary → always-false)
- `out/metrics/bounceRevertGitAdapter.js:34:30` (`===` → `!==`)
- `out/metrics/bounceRevertGitAdapter.js:34:48` (`'number'` → `""`)
- `out/metrics/bounceRevertGitAdapter.js:34:79` (`stdout: ''` → placeholder text)

**C. The blank-line filter on `git log` output, `bounceRevertGitAdapter.ts`
— a genuine gap: every fixture's `git log` in the current tests never
produces a trailing blank line, so filtering it out is unobserved.**
- `out/metrics/bounceRevertGitAdapter.js:73:26` (filter call removed)
- `out/metrics/bounceRevertGitAdapter.js:73:66` (`line.length > 0` → always-true)
- `out/metrics/bounceRevertGitAdapter.js:73:66` (`>` → `>=`)

**D. The early-return branch for "commit or branch doesn't resolve",
`bounceRevertGitAdapter.ts` — a genuine gap: current tests exercise "both
resolve" (the common path); no test isolates EITHER individual
unresolvable-ref case with assertions on this branch's own returned
fields.**
- `out/metrics/bounceRevertGitAdapter.js:80:9` (condition → `false`)
- `out/metrics/bounceRevertGitAdapter.js:80:9` (`||` → `&&`)
- `out/metrics/bounceRevertGitAdapter.js:80:45` (branch body removed)
- `out/metrics/bounceRevertGitAdapter.js:81:95` (`ancestorOfMain: false` → `true`)
- `out/metrics/bounceRevertGitAdapter.js:81:109` (`files: []` → placeholder array)

**E. Boolean-flag computation in the byte-identical-restoration check,
`bounceRevertGitAdapter.ts` — a partial gap: the tested fixtures' first
operand is always true in the reached cases, so forcing it to a literal
`true` does not change the observed outcome there.**
- `out/metrics/bounceRevertGitAdapter.js:98:44` (`bounced !== null && ...` → `true && ...`)
- `out/metrics/bounceRevertGitAdapter.js:102:39` (`bounced !== parent` → `true`)

**F. `liveFiles: []` on the verdict's default base object,
`bounceRevertVerdict.ts` — this field is overwritten on every reached
code path before being read; the default's own value is unobserved.**
- `out/quality/bounceRevertVerdict.js:16:102` (`liveFiles: []` → placeholder array)

**G. `record-bounce.ts`'s CLI-wiring defaults — the default
`revertCheckSeam` object, the `run()` call's argument object, and the
re-exported `parseArgs`'s `enumerable` flag are each either replaced by
every test that reaches them (tests inject their own seam before invoking
`main`) or never observably read via normal `require()` usage
(`enumerable` only affects `for...in`/`Object.keys()` enumeration, not
destructuring) — equivalent for this module's actual call surface.**
- `out/tools/record-bounce.js:20:44` (`run({...args})` → `run({})`)
- `out/tools/record-bounce.js:29:24` (`liveFiles: []` → placeholder array)
- `out/tools/record-bounce.js:10:59` (`enumerable: true` → `false`)
- `out/tools/record-bounce.js:14:27` (`{ run: bounceRevertCheck }` → `{}`)

## Not force-discharged, not force-killed

No mutant was suppressed, no assertion was loosened to manufacture a kill,
and no new test was authored here to chase these down — coverage/mutant-
killing work is hardener's domain (Article 1.6), downstream in this
ticket's own pipeline. Groups B, C and D are real, honestly-reported
coverage gaps a hardener pass could close; A, F and G read as at or near
equivalent for this module's actual contract. This discharge records what
ran, completely and accurately, per the ticket's own invariant 1 (a run
that cannot complete stays outstanding; a run that DID complete, with
survivors, is discharged with every survivor named and reasoned - never
force-passed, never left unrecorded).

## Verification

| check | result |
|---|---|
| `mutation_cooldown_gate.bb` on all three files | `run` (9.44/9.44/17.93 days) |
| `constitutionDocCitations.test.js` | 6/6 |
| `test/strykerSandboxSiblingsLib.test.js` (regression, sibling list) | 21/21 |
| `test/hardenerTooling.test.js` (regression) | 5/5 |
| `test/bl643NonPipelineAgentsStepsGuards.test.js` (regression) | 7/7 |
| `npx stryker run stryker.bl1439.config.json` | 191 mutants, 166 killed, 25 survived, 0 timeout, 0 errors — completed run |
