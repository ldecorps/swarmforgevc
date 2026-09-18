# BL-1616 — LAND_ESCALATE, BL-1601/BL-1604/BL-1620/BL-1626 entangled, 2026-09-18

`land_step_cli.bb BL-1616 <tip>` refuses with `LAND_ESCALATE`, naming
`ENTANGLED_SIBLING BL-1601,BL-1604,BL-1620,BL-1626`.

## Already resolved this pass

`backlog/evidence/BL-1601-coder-20260917.md` was a pure-doc file stranded
off BL-1601's own tip-pure replay (`c537f7e552`, built but apparently
never pushed — BL-1601 is closed in `backlog/done/`). No code, no
dependency risk. Restored byte-identical, untagged subject, landed
directly at `759219026d` — matches the already-adjudicated
"closed-ticket-subject-on-role-branch-blocks-every-land-behind-it" class
(prior specifier ruling, BL-1546/BL-1617 lineage).

## New finding this pass — genuinely tangled, not a simple restore

The land step's NEXT refusal names
`extension/test/bl1601TmpDirSweepRetryInvariant.property.test.js`, also
stranded off BL-1601's `c537f7e552` replay. Restoring it is NOT the same
simple case:

- `c537f7e552`'s own tree carries an EARLIER shape of
  `extension/test/helpers/tmpDir.js`'s `removeWithRetry` (bare `rmFn`
  parameter, a local `sleepSyncMs`, `REMOVE_RETRY_ATTEMPTS = 5` literal).
- Cherry-picking `c537f7e552` onto current `origin/main` applies with two
  conflicts (`backlog/standing-reds.tsv` — trivially resolved, the
  replay's stale row removal is long since moot; `tmpDir.js`'s
  `module.exports` — trivially resolved, BL-1623 exports origin/main
  already has). Both resolved cleanly in a scratch worktree, NOT pushed.
- But BL-1616's own tip (my QA branch) carries a THIRD, NEWER shape of
  the SAME function (`removeWithRetry(dir, optionsOrRmFn = {})`, imports
  `sleepSync` from `waitForFileSync.js`, `DEFAULT_REMOVE_RETRY_ATTEMPTS`/
  `DEFAULT_REMOVE_RETRY_DELAY_MS`/`RETRYABLE_REMOVE_CODES`) —
  `git diff c537f7e552 HEAD -- extension/test/helpers/tmpDir.js` is
  substantial, not empty. Traced via `git log -- extension/test/helpers/
  tmpDir.js`: this shape entered through `39e4035a5d Merge coder
  0e99d4ad74 into cleaner.`, and `0e99d4ad74` is
  **`BL-1620: telegramFrontDeskBotCli.test.js under the 7000ms per-file
  budget`** — BL-1620 is `status: todo`, still in `backlog/active/`,
  itself one of BL-1616's named entangled siblings.

So three generations of the same function exist: (1) origin/main's
current landed shape (BL-1601's original pass, `98188c9db5`), (2)
BL-1601's own rework, replayed but never pushed (`c537f7e552`), (3)
BL-1620's further rework on top of (2), unlanded, active. Landing (1)→(2)
myself (as I did for the pure-doc file) would not even match what BL-1616
inherits, since BL-1616's own tip already carries (3). I have not pushed
any of this — the scratch cherry-pick was built, reviewed, and discarded.

## What needs a ruling

1. Is BL-1601's rework (`c537f7e552`'s tree) still the intended final
   shape, superseded correctly by BL-1620's further changes — i.e.,
   should BL-1620 land (or its `tmpDir.js` hunk specifically) before
   BL-1616 can cleanly replay past this entanglement? Or
2. Does `extension/test/bl1601TmpDirSweepRetryInvariant.property.test.js`
   need rewriting against whichever shape lands first?
3. BL-1604 and BL-1626 are also named `ENTANGLED_SIBLING` but the tool's
   refusal reason so far only cites BL-1601's two paths — they may or may
   not independently block once these are resolved; not yet reached.

BL-1616 itself is unaffected in substance: it does not touch
`tmpDir.js` or the BL-1601 test file at all (confirmed via
`git diff origin/main..HEAD --name-only`, BL-1616's own attributed paths
are `handoff_lib.bb`, its runner, the feature, the handler, evidence and
one docs cross-link). This is purely a land-sequencing entanglement
among OTHER tickets sharing ancestry with BL-1616's branch, not a defect
in BL-1616's own work — the QA approval already recorded
(`backlog/evidence/BL-1616-QA-20260918.md`) stands.

By QA.
