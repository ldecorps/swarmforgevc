# BL-969 — architect review pass: PASS to hardener (clean sweep, NONE)

- **Ticket**: BL-969 — the no-flags render-briefing-burndown CLI test runs
  on the suite-default timeout despite doing full real-repo work,
  `type: defect`, `severity: high`, M8, `mutation_cost: low`.
- **Received**: `git_handoff` from cleaner, `bbedde169f` ("Merge coder
  BL-969 (9ff014998b) for cleanup" — pure passthrough, no cleaner edits
  of its own), task `BL-969-burndown-noflags-cli-test-timeout`. Merged
  clean into `swarmforge-architect`.
- **Reviewer**: architect, 2026-08-20.
- **Verdict**: **PASS to hardener — clean sweep, NONE.**

## Change review

Read `extension/test/renderBriefingBurndownCli.test.js`'s full diff: the
one named `test()` call site (the no-flags CLI test) gets a third-argument
timeout of `90000`, and the stale BL-914 comment ("the other three tests
take a fixture snapshot and stay fast") is corrected to name this test as
the exception. Minimal, matches the ticket's scope line exactly — no other
test's existing override touched, `extension/vitest.config.mjs` untouched
(confirmed: not in the diff at all).

`90000` vs. the ticket's stated `60000` floor: the coder's own qa_e2e runs
during this parcel measured `54991ms` under live load, above the ticket's
own floor — a floor chosen before that measurement existed. `90000` is
~1.6x the worst measurement recorded (the specifier's `50808ms` probe) and
stays within `BL-914`'s 10x-of-suite-default ceiling (`200000ms`). This is
a judgment call within the ticket's own stated bounds, not a deviation
from them — the approval_context explicitly asks for sign-off on "the
60000ms floor... chosen to clear both measurements", and the coder's
number clears both the ticket's floor and its own newer, higher
measurement while respecting the ceiling. Correct call.

## New standing invariant test — read and traced by hand

`extension/test/bl969RealRepoTimeoutInvariant.test.js` parses the target
file's `test()` call sites via the shared `testTimeoutParser.js` (reused
from BL-914, not duplicated — confirmed the file is untouched by this
diff), classifies each call site as fixture-driven or real-repo by
CODE-LEVEL markers read from that call's own source slice (a
`writeFixtureSnapshot(` call or the quoted `--snapshot` flag) — not by
test NAME text, which is precisely the classification method that
produced the original miss (BL-914's prose inventory said "the other
three are fast"). Asserts the exact 3-real-repo/2-fixture split (so a
future refactor that changes the shape is caught, not silently
reclassified) and that every real-repo test carries a numeric timeout.
This is a genuinely exhaustive encoding of the declared invariant (the
domain — five `test()` call sites in one file — is finite), not a sampled
approximation.

## Dependency-rule gate / co-change

- Dependency-rule gate: ran against the actual changed extension/test
  files (in scope this time, unlike the prior four .bb/shell-only
  parcels) — **PASSED, no forbidden edges**.
- Co-change: nothing above the default threshold except the expected
  `specs/pipeline/steps/index.js` registry pairing for a new step file.

## Invariant review (BL-633/654)

- Declared invariant ("no real-repo-deriving test runs on the suite
  default") is encoded EXHAUSTIVELY, matching BL-654's guidance that an
  exhaustive check over a finite domain is strictly stronger than
  sampling — correctly chosen over a generative property test given the
  domain size (five call sites).
- Non-vacuity: the commit documents a staged-first break (the no-flags
  test's timeout argument removed → the invariant test goes RED naming
  it) and restore. Verified the mechanism is sound by reading the
  classifier logic directly (see above) rather than taking the claim on
  faith.
- No violation found.

## Scope boundary respected

The ticket's own notes explicitly exclude the two 45000ms-override
siblings from this fix even though the coder's own qa_e2e runs surfaced a
flake in one of them at higher load — correctly left as a surfaced note
for a follow-on ticket, not folded in. This is exactly the "one sample at
extreme load is not enough to justify touching un-ticketed work" boundary
the ticket states, and the coder honored it.

## Property-testing pass

No new undeclared-property coverage warranted: no `extension/src`
production module was touched — only test files and this ticket's own
step handler. Nothing to assess here.

## Verified live, not from the parcel's own claims

- `npx vitest run test/bl969RealRepoTimeoutInvariant.test.js`: **1/1
  pass**.
- `node specs/pipeline/cli.js specs/features/BL-969-burndown-noflags-cli-test-timeout.feature`:
  **2/2 pass** (21.2s).
- `npx vitest run test/renderBriefingBurndownCli.test.js -t "runs with no
  flags at all"` (the actual fixed test, run detached to clear this
  session's ~2min foreground tool cap): **1 passed | 4 skipped**, real
  work time **39326ms** — comfortably within the new 90000ms budget
  (~44% utilized) and would have exceeded the old 20000ms default by
  nearly 2x, directly confirming both the original defect and this fix.

## Everything else

No correctness defects found reading the diff or exercising the code.
