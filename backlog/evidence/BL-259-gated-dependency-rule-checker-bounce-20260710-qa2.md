# BL-259 bounce evidence — 20260710 (QA, second pass)

## Failing command

```
cd extension && npm run crap
```

## Commit hash tested

`cbf9fd28df` (QA's merge of documenter's handoff `5e8baab7ad`).

## First error excerpt

```
src/tools/dependency-gate.ts	findMediaJsFiles	complexity=6	coverage=90%	CRAP=6.04  *** CRAP > 6 ***
...
93 function(s) exceed the CRAP <= 6 threshold.
```

`findMediaJsFiles` (introduced in this ticket's own `648f76d`, the coder's
original fix for my first bounce, and unchanged since) breaches the
CRAP<=6 gate. Confirmed this is NEW debt this ticket introduces, not
pre-existing baseline: the total violation count is 93, one more than the
92-function baseline consistently reported across every other ticket this
session (BL-233, BL-244, BL-250, BL-253, BL-254, BL-261, etc. all reported
exactly 92 unrelated pre-existing violations).

## Failure class

`unit`

The hardener's own required merge criterion (constitution Article 4:
"Hardener – 100% test coverage, no surviving mutants, CRAP <= 6") is not
met for this ticket's own new code. Not a compile/acceptance-suite
failure — 191/191 unit test files (2620 tests) and all 11/11 of BL-259's
acceptance scenarios pass; `npm run crap` is a separate, explicit gate
this session has treated as authoritative throughout (e.g. BL-250's
`parseArgs` fix from 8.23, BL-233's `isRawCatalogEntry` fix from 8.23,
this same ticket's own earlier `stripComments` fix from 18.23).

## Expected vs observed

Expected: every function this ticket introduces or touches is at or under
CRAP<=6 before reaching QA — the hardener's `7b5c91c` commit explicitly
fixed `stripComments`'s own CRAP overage (18.23 -> 5.00) in this same
file's sibling module, proving the gate was checked and enforced for that
function; `findMediaJsFiles` in the CLI-side file simply was not re-swept
in that same pass.
Observed: `findMediaJsFiles` sits at CRAP=6.04 (complexity=6, coverage=90%),
just over the line, and has been since the very first commit that
introduced it (`648f76d`) — none of the three subsequent architect-bounce/
hardener rounds (all scoped narrowly to the no-webview-storage regex/
comment-stripping correctness issue) re-ran a full-file CRAP sweep to
catch it.

## Suggested fix scope (coder/hardener call, not prescribed here)

Same established pattern already used twice in this exact file tree this
session (`stripComments`'s own split, and BL-250's/BL-233's CLI
`parseArgs` splits): extract `findMediaJsFiles`'s per-scope-path handling
(the try/stat/isDirectory/endsWith branch) into a small named helper so
the outer loop's own complexity drops, same behavior. Re-verify with
`npm run crap` that the total violation count returns to 92 (no net-new
debt), not just that this one function individually reads <=6.
