# BL-1207 hardener pass — 2026-08-28

## Restoring collaterally-reverted content

Found via the coordinator's note ("BL-1207 merged 06:07Z, no hardening
pass/forward yet - check queue"): the architect's merge (`86babd710`, at
06:07Z) had already landed cleanly in this worktree, but before I could
harden and forward it, a QA merge-up (`df9899feb`, for BL-1227) needed
merging into this worktree too. QA's line had reverted a botched wholesale
merge (`778991d21`, undoing `97b88aa8b`) that had entangled several tickets'
tips together — its own commit history names the entangled set explicitly:
"BL-1227 QA bounce: entangled tip carries BL-1192/1201/1207/1211/1216"
(`002a4c672`).

Resolving that merge's conflicts, I correctly dropped BL-1211's and
BL-1216's content (each independently bounced multiple times by QA for its
own defects — see `backlog/evidence/QA-mergeup-BL-1227-hardener-20260828.md`).
But BL-1207 was never independently bounced — it has no
`QA bounce`/`bounce_history` commit of its own on `main`, unlike BL-1211
(bounce_count 2) and BL-1216 ("fourth occurrence"). It was purely an
entangled passenger dragged along by the same bad batch merge, and my merge
resolution collaterally reverted its clean, already-cleaner-and-architect-
reviewed fix back to the pre-fix defective test.

Confirmed collateral damage, not a legitimate revert: after the QA merge,
`extension/test/cursorBridgeAgentSession.test.js` had reverted to the
original buggy `'  42  \n'` row under "rejects invalid pid values" — exactly
the defect this ticket exists to fix. It read green only because this host's
pid 42 is not currently live (`ps -p 42` returns nothing here) — the exact
host-dependent masking the ticket describes.

Per workflow.prompt's entangled-batch-merge guidance ("revert the bounced
ticket's own commits/paths instead — never the batch merge, never nothing"),
restored BL-1207's own self-contained fix from my own prior merge commit
(`4924e4077`, before the QA merge), which still had it intact:
- `extension/test/cursorBridgeAgentSession.test.js` (the diff is BL-1207-only,
  confirmed by diffing `4924e4077`'s version against the post-QA-merge
  version — no BL-1192/1211/1216 content mixed in).
- `specs/pipeline/steps/bl1207AbandonedLockLivenessSteps.js` (new file,
  restored verbatim).
- `specs/pipeline/steps/index.js` (re-added the `bl1207AbandonedLockLivenessSteps`
  require).

## Hardening review

No `extension/src/**` or `extension/out/**` file changed by this ticket —
production (`readLockHolderPid`'s `.trim()`, `isProcessAlive`'s EPERM-as-alive
branch) is untouched throughout, per the ticket's firm constraint. Mutation/
CRAP/DRY tools scope `src/`/`out/` only, so nothing to run for those, matching
the cleaner's own note in `backlog/evidence/BL-1207-cleaner-pass-20260828.md`.

Verified the qa_e2e_procedure's key checks directly:
- `npx vitest run test/cursorBridgeAgentSession.test.js` — 63/63 green
  (matches the pre-collateral-revert count).
- Isolated re-run of `-t "EPERM"` and `-t "skips"` (the two nearest-branch
  regression guards named in the procedure) — both green individually.
- `run_acceptance.sh specs/features/BL-1207-abandoned-lock-verdict-is-host-independent.feature`
  — 8/8 green, including "the declared unreachable pid is unreachable on
  the host running the suite" and "no malformed case names a value the host
  could be running" (the non-vacuity/structural-guard scenarios).
- `node -e "require('./specs/pipeline/steps/index.js')"` — loads clean.

## Cleanup

No orphaned test/mutation processes. `git status` clean except the 3 files
restored above (2 modified, 1 new).

By hardener.
