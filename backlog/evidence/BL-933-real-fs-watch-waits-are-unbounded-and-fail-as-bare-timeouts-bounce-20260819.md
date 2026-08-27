# BL-933 architect bounce — 2026-08-19

## Reviewed commit
`b8e416241af319847a84115530d381c79655dee9` ("BL-933: bound the three
real-fs.watch waits with a diagnosable deadline", By coder, forwarded
unchanged by cleaner).

## What passed
- Dependency-rule gate (`node extension/out/tools/dependency-gate.js`) on all
  5 touched extension files: PASSED, no forbidden edges.
- Co-change report on the same files: only flags the three sibling test
  files against each other (activateBounceWatcher/bounceDrain/bounceWatcher,
  4 co-changes each) — expected, they share this ticket's defect pattern.
  No other concerning coupling.
- All three touched test files plus the new helper's own suite: 68/68 green
  (`npx vitest run test/activateBounceWatcher.test.js test/bounceDrain.test.js
  test/bounceWatcher.test.js test/helpers/boundedWatchWait.test.js`).
- Real `fs.watch` / `fs.writeFileSync` setup is untouched in all three test
  files — invariant 1 (real events stay real, no fakes) holds structurally.
  Confirmed by reading each diff directly, not just the acceptance scenario.
- Fixture hygiene: `activateBounceWatcher.test.js` now wraps `watcher.close()`
  in `try/finally` (the other two already did), so cleanup still runs when
  `awaitRealWatchEvent` rejects on expiry, not only on success. The dropped
  manual `fs.rmSync` is still covered by `tmpDirSetup.js`'s global per-test
  `afterEach` sweep (confirmed present in `extension/test/helpers/tmpDir.js`).
  No BL-928-class leak reintroduced.
- Step handlers (`specs/pipeline/steps/bl933BoundedWatchWaitSteps.js`)
  correctly registered in `index.js`; Scenario Outline validates against an
  explicit `KNOWN_TESTS` lookup, throws on an unknown token — no passthrough.

## D1 — invariant-unencoded (blamed: coder)

The ticket (`backlog/active/BL-933-...yaml`) declares two invariants. Both
were present in the ticket file **before** the coder started work:

- `invariants:` block added at commit `67bf2d329` ("Approve BL-933: record
  human_approval"), 2026-08-18T23:57:42+01:00.
- Ticket promoted paused → active at `aad7fbf52`, 2026-08-19T04:44:01+01:00
  — already carrying the invariants.
- Coder's commit `b8e416241a` lands at 2026-08-19T05:00:02+01:00, nearly an
  hour after promotion.

The coder's own commit message states: *"No invariants declared on this
ticket, so no property-test obligation."* This is factually false — the
invariants were declared the entire time the coder held the parcel. There is
no evidence the coder engaged with the ticket's `invariants:` section at all
before writing that line.

Per the architect's Invariants Review gate, each declared invariant needs
either an executable property test or a stated non-encodability reason
before any hand-verification. Assessed individually:

- **Invariant 1** ("real fs.watch event delivery stays real ... never a
  fake or stubbed watcher"): this is a structural/qualitative fact about
  fixed source text, not a property over an input range — it does not
  obviously admit a fast-check-shaped encoding, and the ticket's own
  acceptance Scenario 3 (source-text check for `fakeWatcher|stubWatcher|
  mockWatcher`) already exercises it. I am not bouncing this half of D1 for
  a missing property test — a fast-check property here would very likely be
  vacuous. But the coder never said any of this; it was asserted "no
  invariants" instead, which is the actual defect: nobody made the call
  because nobody looked.
- **Invariant 2** ("no wait ... left unbounded ... explicit deadline ...
  fails naming the event"): this DOES admit a natural, non-vacuous property
  encoding. `extension/test/helpers/boundedWatchWait.js` is a brand-new,
  pure, fully synchronous-under-fake-timers, generic module parameterized by
  `eventLabel` / `watchedPath` / `timeoutMs` — exactly the shape the
  Property Testing section calls out. A property test sweeping arbitrary
  (non-empty) `eventLabel`/`watchedPath` strings and `timeoutMs` values,
  asserting that a never-resolving input promise always rejects at its
  configured deadline (via `vi.useFakeTimers()`, same convention the
  existing example tests already use) with a message containing both the
  label and the path, is straightforward and would catch a real regression
  class (e.g. a future edit that only formats the message correctly for the
  three specific label/path strings the existing example tests happen to
  use). Current coverage
  (`extension/test/helpers/boundedWatchWait.test.js`) is entirely
  example-based, fixed values only, not in `*.property.test.js`, not run by
  `npm run test:properties`. No property test exists and no non-encodability
  reason was stated for it.

**Remediation**: the coder adds a fast-check property test for invariant 2
on `boundedWatchWait.js` (own `*.property.test.js` file per the pinned
convention, non-vacuous — show it fails against a deliberately-broken
variant, e.g. one that swallows `timeoutMs` or drops the label/path from the
message, then restore it), and corrects the commit-message-level claim so
downstream roles (hardener, documenter, QA) don't inherit "no invariants on
this ticket" as fact. No change needed to invariant 1's treatment beyond
that acknowledgment — the acceptance-scenario coverage already in this
parcel is adequate for it.

## Inventory completeness
This is the whole review pass — one bounce, one item. No other check was
blocked by D1.
