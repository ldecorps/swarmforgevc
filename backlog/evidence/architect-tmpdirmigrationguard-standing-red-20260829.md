# tmpDirMigrationGuard.test.js's "real tree" scan is red, untracked

Architect, 2026-08-29. Found while reviewing BL-1209 (mkdtemp check resolves
its detector from the tool). Not BL-1209's defect and not fixed here.

## What

`extension/test/tmpDirMigrationGuard.test.js`'s test "the real extension/test/
tree has zero raw mkdtemp call sites outside the shared helper" fails,
reporting ~30+ violation lines across ~20+ files (agentNotesCore.test.js,
alertTelemetry.property.test.js, humanLoopReliability.test.js,
pilotMkdtempConventionCheck.test.js, and more — full list in the test's own
failure output).

## Why it is not BL-1209's

Every single flagged file/line already carried the same raw `mkdtempSync`
call, unchanged, at commit `f6d369da3` — the tip immediately before BL-1209's
own commit (`e272c6b01`) touched anything. `agentNotesCore.test.js` in
particular is never touched by BL-1209 at all. BL-1209's own two directly
relevant test files (`pilotMkdtempConventionCheck.test.js` and its property
file) pass 100% of their own assertions; only this one, unrelated,
pre-existing scan-of-everything test is red, and was red before BL-1209 too.

## Not already ticketed

Grepped `backlog/{paused,active,hold,done}` for `tmpDirMigrationGuard`,
`agentNotesCore`, `bl790-roles` (one of the flagged fixture prefixes), and
"raw mkdtemp call sites". No open ticket names this specific standing red.
`backlog/hardening-debt-ledger.yaml` and `backlog/hotfix-ledger.yaml` do not
mention it either.

## Reproduce

    cd extension && npx vitest run test/tmpDirMigrationGuard.test.js

## Recommendation

Worth a ticket: either migrate the ~20 flagged files to the shared `mkTmpDir`
helper (BL-420's own convention), or determine some of them are legitimately
exempt (e.g. `pilotMkdtempConventionCheck.test.js`'s raw-call FIXTURE STRINGS
are test data, not real usage, the same shape `tmpDirMigrationGuard.test.js`'s
own SELF_EXEMPT list already carves out for itself) and widen the exempt list
accordingly. Not this architect's call to make — routed to the specifier.
