# BL-1243 — hardener re-pass after QA bounce

Hardener, 2026-08-30. Merged architect's re-pass `e248b1846d` (QA bounced
D1-D4 — invariant 3 not implemented, scenario 06's `When` step missing, the
reused `Then` step hardcoded `'ok'` so it structurally could not exercise
`err`, and a doc entry describing a fix that didn't exist yet; coder fixed
all four, architect confirmed 7/7 acceptance and all invariants).

## Mutation cooldown gate (BL-149)

```
extension/src/bridge/residentSpyUiHtml.ts   DECISION: run
file_age_days: 3.50 (cooldown: 3 days)
load_avg: 4.70  cores: 20  busy_threshold: 2.00x (quiet)
```

Eligible and host quiet — proceeded.

## Stryker cannot see this file's own logic — hand-authored sweep (documented
## class, this exact file is named in the standing rule)

`resolvePaneStatusKind` lives inside the `<script>` block of the template
literal `getResidentSpyUiHtml()` returns. Per the standing rule ("A bridge
getXxxUiHtml() inline <script> is invisible to Stryker"), `residentSpyUiHtml.ts`
is one of the eight files named there explicitly. Confirmed again here:
`crapReport.js` against this file shows only the wrapper
`getResidentSpyUiHtml` (complexity=1, CRAP=1.00) — the internal function's
own branches are invisible to both Stryker and CRAP. The JSDOM +
extractInlineScript harness (already present in
`test/residentSpyUiHtml.test.js`) plus the source-text-extraction technique
in `test/bl1243PaneActivitySignal.test.js` (regex-lifts the real function
body, never a hand-copied restatement) are the only mutation coverage this
function gets.

Hand-mutated `resolvePaneStatusKind` directly (the D1 fix), restoring after
each, `npx vitest run test/bl1243PaneActivitySignal.test.js
test/residentSpyUiHtml.test.js` as the kill oracle:

- `aggregateKind === 'err'` negated to `!== 'err'` — KILLED (existing
  scenario-06 test asserts `resolve(busy, 'err') === 'err'`).
- `pane && pane.activitySignal` → `pane || pane.activitySignal` — KILLED.
- `!pane || pane.available === false` → `!pane && pane.available === false`
  (OR to AND) — KILLED (the BL-1160 "unavailable pane dot is hidden"
  regression test: with the mutant, `documenter`'s dot renders green instead
  of hidden. First combined-suite run under-reported this as SURVIVED due to
  a shell-script summary-line grep bug on my end, not a real gap — re-run in
  isolation with `-t "unavailable pane dot is hidden"` showed the correct
  failure immediately, and the corrected combined-suite re-run agreed).
- final fallback `return aggregateKind` → `return null` — KILLED.

All four mutants restored; compiled/source file diffed byte-identical
against the pre-mutation copy before the final clean re-run.

## Re-verified the architect's headline claims (all clean)

- `npx tsc -p .` — clean.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1243-...feature`: 7/7 (matches QA's expected total).
- `npx vitest run test/bl1243PaneActivitySignal.test.js
  test/residentSpyUiHtml.test.js test/residentPaneLive.test.js`: 47/47.
- `npm run test:properties -- bl1243`: 4/4.

## CRAP

`residentSpyUiHtml.ts`: only `getResidentSpyUiHtml` is visible to the tool
(complexity=1, CRAP=1.00) — the touched internal function is inside the
inline script, invisible by construction (see above; hand sweep is the real
evidence). `residentPaneLive.ts` unchanged in this bounce-fix commit;
`tryCaptureRolePane`'s pre-existing CRAP=6.03 already confirmed grandfathered
debt, not a regression, in this session's earlier BL-1243 pass
(`backlog/evidence/BL-1243-hardener-pass-20260830.md`) — re-confirmed
unchanged here since the file was not touched.

## DRY

`npx jscpd src/bridge/residentSpyUiHtml.ts --min-lines 10`: 0 clones.

## Whole-tree standing guards (parcel touches `extension/test/` and
`specs/pipeline/steps/`)

Ran all 17 non-property `test/*Guard*.test.js`. 3 failed —
`liveRepoDerivationGuard`, `socketFixtureShortRootGuard`, `tempDirTrapGuard`
— the same confirmed pre-existing standing-red set named in every prior
hardener pass this session. None names `bl1243` or the changed source file.

## Full re-verification

Full `npx vitest run`: 26 failed / 218 failed, 552/578 files passed —
identical failure count to the standing baseline. No regression.

## Orphan process check

Every `node --test|stryker|vitest` process checked by `/proc/<pid>/cwd`;
none rooted in this hardener worktree survived past this pass.

## Verdict

Hardened. The QA-bounced invariant-3 fix and its two step-handler fixes are
all mutation-verified by hand (Stryker structurally cannot see this file's
inline-script logic — documented class, this file is named in the standing
rule). No new gaps found. Forwarding to documenter.
