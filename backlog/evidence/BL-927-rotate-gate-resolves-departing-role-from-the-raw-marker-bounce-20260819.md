# BL-927 QA bounce — 2026-08-19

## Failing command
```
node specs/pipeline/cli.js specs/features/BL-927-rotate-gate-resolves-departing-role-from-the-raw-marker.feature
```
(all 7 scenarios pass functionally; the defect is a leftover-fixture check run
immediately afterward: `find "$TMPDIR" -maxdepth 1 -iname "bl927-rotate-gate-*"`)

## Commit hash
`0959ef358289fc5c2cc70124116aac8731248c0e` (documenter's merge of BL-909/BL-927
into QA; the offending file is unchanged since the coder's original BL-927
commit `2d3133fa651b9000a90aba9224b5c6bb99adeb33` and its cleaner/architect/
hardener/documenter merges — grep below confirms it).

## First error excerpt
```
$ find /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T -maxdepth 1 \
    -iname "bl927-rotate-gate-*" -exec stat -f "%Sm %N" -t "%Y-%m-%d %H:%M:%S" {} \;
2026-08-19 03:43:10 .../T/bl927-rotate-gate-FcL5yW
2026-08-19 03:43:10 .../T/bl927-rotate-gate-iLPDeO
2026-08-19 03:43:10 .../T/bl927-rotate-gate-maraJn
2026-08-19 03:43:10 .../T/bl927-rotate-gate-yWhlzX
2026-08-19 03:43:11 .../T/bl927-rotate-gate-bBZBjl
2026-08-19 03:43:11 .../T/bl927-rotate-gate-q5Rk5r
2026-08-19 03:43:11 .../T/bl927-rotate-gate-zfdKzV
```
Seven fresh directories, timestamped to the exact second of my own
`run_acceptance.sh` invocation of this feature (which reported 7/7 scenarios
passing at 03:43:11). Each is a full git-repo fixture built by `seedFixture()`
via `fs.mkdtempSync(os.tmpdir(), 'bl927-rotate-gate-')` in
`specs/pipeline/steps/bl927RotateGateLiveIdentitySteps.js`.

```
$ grep -n "mkdtempSync\|finally\|rmSync" specs/pipeline/steps/bl927RotateGateLiveIdentitySteps.js
51:  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl927-rotate-gate-'));
210:      const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'bl927-fakebin-'));
```
No `finally`, no `rmSync`, anywhere in the file — for either the main
`bl927-rotate-gate-` fixture root or the nested `bl927-fakebin-` directory
created inside it at line 210.

## Failure class
`behavior` (a functional-correctness gap in the deliverable itself — a leaked
fixture directory on every acceptance run — not a compile, unit, integration,
or acceptance-scenario failure; every scenario's own assertions pass).

## Expected vs observed
Expected: per the engineering article's "fixture temp dirs are removed in a
`finally`" rule (adopted 2026-08-18 from an architect `rule_proposal` raised
during this exact ticket's own review session, after the BL-921/BL-922
bounces), zero `bl927-*` directories remain under `$TMPDIR` after the
acceptance run completes — matching the sibling BL-929/BL-931 step handlers'
own bounce remediations, and matching this repo's compliant idiom
(`bl413StaleSandboxSweepSteps.js`, `bl458AcceptanceFixtureProcessLeakSteps.js`,
`bl632CommitTimeGuardSteps.js`, `bl925...Steps.js` (BL-925's own step handler,
this session), etc.).

Observed: 7 fresh fixture directories left behind by this single run — every
scenario invocation leaks its own `seedFixture()` root, and any scenario that
reaches the `Given a live tmux session ...` step additionally leaks a nested
`bl927-fakebin-*` directory inside it. 272 total `bl927-rotate-gate-*`
directories exist under `$TMPDIR` on this host as of this bounce, accumulated
across every prior coder/cleaner/architect/hardener/documenter run of this
same file through this ticket's development — the architect's own two review
passes (original bounce evidence and repass evidence, both in
`backlog/evidence/BL-927-architect-*-20260819.md`) verified D1 (a
babashka.process/clojure.java.shell subprocess-mechanism regression) and ran
this exact acceptance command twice, but neither pass checked `$TMPDIR` for
leftover fixtures afterward, so this leak was never caught before landing
here.

## Remediation pointer
`specs/pipeline/steps/bl927RotateGateLiveIdentitySteps.js`: wrap the
`^the resident rotate helper is invoked...`/equivalent "When" step body(ies)
that currently read `ctx` state built during `Given` steps in
`try { ... } finally { fs.rmSync(dir, { recursive: true, force: true }); }`,
same shape as BL-929's and BL-931's own bounce remediations in this same
ticket cycle (`specs/pipeline/steps/bl929LiveScreenPackLayoutSteps.js`,
`specs/pipeline/steps/bl931RotatePackGateSteps.js`) — check whether any
`Given`/`Then` step here can itself throw BEFORE the `When` step's own
try/finally runs (BL-931's hardener found exactly this shape: an earlier
step throwing on an unrecognized Scenario Outline example value leaks the
Background-created fixture, since a `finally` local to the `When` step
cannot protect a directory created by a step that ran and threw before it).
The nested `bl927-fakebin-*` directory (line 210) needs its own cleanup or
must be created inside the already-cleaned `dir` root rather than directly
under `os.tmpdir()`.

Owning role: **coder** (owns this new file, same routing as the sibling
BL-929/BL-931 bounces for the identical defect class).
