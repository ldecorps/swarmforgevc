# BL-914 architect pass — 2026-08-19

## Reviewed commits
`d63a9bdcf` ("BL-914: per-test timeout headroom for six heavy real-work
unit tests", By coder) and `d8b3f11b3f` ("BL-914: cleaner pass - dedupe
scanBalanced/splitTopLevelArgs's string/comment skip", By cleaner). Scoped
diff (`git diff d63a9bdcf^ d8b3f11b3f --stat`, base is the coder's own
pre-work commit, not an intervening unrelated merge): 6 files — 3 test
files' timeout overrides, `bl914PerTestTimeoutSteps.js` (new),
`testTimeoutParser.js` (new), `index.js`'s registration line.

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate**: ran per-parcel mode against the 3 changed
   `extension/test/` files from `extension/` — **PASSED, no forbidden
   edges**. The other 3 changed files live under `specs/pipeline/` —
   outside this gate's `src`/`media` scope.
2. **Co-change report**: ran against all 6 changed files (minus the
   registry-hub `index.js`, per BL-938 precedent — its many frequency-3
   hits are structural noise from being appended to by every step-handler
   ticket). Only `renderBriefingDiagramsCli.test.js` showed anything,
   ~18 distinct files each at exactly the frequency-3 threshold plus
   `index.js` — a scattered, no-single-dominant-pair pattern consistent
   with broad batch commits touching many CLI test files together, not
   coupling this parcel introduced. No action warranted.
3. **Invariant 1** ("the suite-wide default `testTimeout` in
   `vitest.config.mjs` is unchanged"): confirmed directly —
   `git diff d63a9bdcf^ d8b3f11b3f -- extension/vitest.config.mjs`
   is empty.
4. **Invariant 2** ("every granted timeout is a bounded number greater
   than the default; disabling a timeout is never acceptable"): read all 6
   `test(...)` call sites — each now carries a literal `45000` third
   argument (bare-number form, not the deprecated `{ timeout }` object
   form — confirmed correct given Vitest 3.2.6's own deprecation warning
   the coder's commit message cites). `45000 > 20000`, finite, bounded.
5. **Site-completeness sweep**: confirmed exactly the 6 named tests (1 +
   3 + 2, matching the ticket's own `## What` list, including the
   2026-08-18 `renderBriefingBurndownCli.test.js` amendment) carry the
   override, and no other test in these 3 files was touched — the
   fixture-snapshot tests and the missing-diagram-source rejection test in
   the same files correctly keep the default 20000ms, per the ticket's own
   scope note.
6. **Ran the new acceptance feature end to end**: `run_acceptance.sh
   specs/features/BL-914-...feature` — **5/5 PASS** (3 Outline rows + 2
   scenarios), both before and after my own addition (item 9 below).
7. **Ran all 3 touched test files live** (`vitest run` against the real
   files, real subprocess/render work, no mocks): **11/11 tests pass**.
   Total wall time 87s — consistent with genuinely heavy, previously-
   near-budget tests now running comfortably inside their new headroom.
   Two `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled-error
   lines appeared — this is BL-871's documented, always-on, non-
   configurable Vitest RPC-heartbeat artifact for a worker that spends
   real wall-clock time inside a synchronous subprocess call, explicitly
   allowlisted by the shared engineering rule; not a test failure (both
   files report 100% pass) and not this parcel's defect.
8. **Cleaner's DRY refactor** (`stringOrCommentEnd` extracted from
   `scanBalanced`/`splitTopLevelArgs`): traced the index arithmetic by
   hand for all three skip cases (string literal, `//` comment, `/*...*/`
   comment) — each returns the exact same index the original inline block
   left `i` at before its own `continue` (verified: string literal returns
   `skipStringLiteral(...) - 1`, matching the original's
   `i = skipStringLiteral(...) - 1`; line comment returns the index of
   `\n` itself, matching the original's post-loop `i`; block comment
   returns `j + 1` where `j` is the index of the closing `*`, matching the
   original's own post-`i++` position) — confirms cleaner's own claim of
   preserved semantics. Re-ran the acceptance feature myself independently
   after this refactor (item 6) rather than only trusting the commit
   message.
9. **Property Testing pass** (BL-654, my own role, not a ticket-declared
   invariant): `testTimeoutParser.js` is new, pure (zero `require`s),
   touched, and left with no dedicated test — only indirect exercise via
   the acceptance step handler against the 3 real files it targets today.
   A parsing/formatting-stability property is a direct fit for this
   module's own documented complexity (its header names the exact
   motivating case: a test name carrying parentheses and an escaped
   quote). Added `extension/test/testTimeoutParser.property.test.js`:
   round-trips a generated `{name, timeoutMs}` list through real
   `test(...)` source (properly escaped, interleaved with realistic
   comment noise that deliberately avoids the literal substring `test(` —
   the module's call-site DETECTION regex is not itself comment/string-
   aware, only its argument scan is, a narrow and accepted scope limit for
   a tool built for 3 named files, not a general JS parser; probing that
   limit would manufacture a misleading failure unrelated to what this
   property verifies) plus a second property locking "no trailing numeric
   arg → `timeoutMs: null`". **Non-vacuity independently verified**:
   desynced `scanBalanced`'s string/comment skip by one index, reran —
   failed on the first generated case; reverted (confirmed via `git
   status` clean) and reconfirmed green. Re-ran BL-914's own 5/5
   acceptance scenarios afterward — unaffected. Committed as
   `d7ca4ca83`.
10. **Module boundaries / two-layer architecture**: not implicated — no
    extension host/webview code touched (all `extension/test/` files are
    test-only), no I/O ownership changed, no new process spawned bypassing
    tmux, no secrets, no webview storage. `testTimeoutParser.js` lives
    under `specs/pipeline/` (SwarmForge's own acceptance harness), not the
    extension's src/media boundary.
11. **Correctness read**: no defect spotted. `testTimeoutParser.js`'s
    call-site detection regex is not comment/string-aware at the
    detection stage (only argument-scanning is) — a real, narrow
    limitation, but the module's own header does not overclaim beyond
    argument-scanning, it is exercised correctly against the 3 real files
    it targets today (confirmed via the live acceptance run), and
    widening its scope is future-proofing a ticket-scoped test utility
    beyond what BL-914 asked for — not a send-back, noted here for the
    record rather than escalated.

## Verdict
No architecture violation, no invariant violation, no correctness defect.
Both declared invariants hold, independently re-verified. Added and
verified non-vacuous property coverage for the one new pure module this
ticket left untested. Forwarding to hardener.

By architect.
