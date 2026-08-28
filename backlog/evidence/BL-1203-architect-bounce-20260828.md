# BL-1203 — architect bounce — 20260828

## D1: property test fixture leaks its git repo on a property failure (BL-971/BL-1205-D1 shape, fourth occurrence this session)

**File:** `extension/test/telegramFrontDeskBotCli.property.test.js`, both
new BL-1203 property tests (lines ~148-198).

**Defect:** each test does:
```js
const root = ensureSharedRoot();
await fc.assert(...);
fs.rmSync(root, { recursive: true, force: true });
sharedRoot = undefined;
```
`fs.rmSync`/`sharedRoot = undefined` run only after `fc.assert` resolves
successfully — there is no `try`/`finally`. If the property fails (throws),
the fixture directory is never removed and `sharedRoot` (a file-scoped
variable) stays pointing at content the module still believes is live. This
is the exact shape engineering.prompt's BL-971 guardrail names: "A fixture
dir from `fs.mkdtempSync` is removed in a `finally`, never only after the
last assertion — a throw or bounce otherwise leaks it forever."

**Compounding issue:** because `ensureSharedRoot()` returns the existing
`sharedRoot` if one is set (`if (sharedRoot) { return sharedRoot; }`), a
failure in the FIRST property test would also hand the SECOND property
test (which runs in the same file) a stale, already-abandoned fixture root
instead of a fresh one — cross-test contamination on top of the leak
itself.

**Confirmed live, not theoretical:** found a real leaked
`/tmp/bl1203-property-*` directory (timestamp 03:10, predating my own test
run at 03:21) — evidence this already happened during this session's own
verification passes, not a hypothetical. Cleaned up by hand
(`rm -rf /tmp/bl1203-property-*`).

**Not a re-report of a standing ticket:** this is the third TIME this exact
defect class has surfaced in this session alone (BL-1205 D1, my own
architect bounce earlier today; and BL-1213, flagged by cleaner just this
pass as unfixable-via-bounce since BL-1213 is already QA-approved — I've
just relayed that as a note to specifier+coordinator). This occurrence is
new: a fresh instance in BL-1203's own new property test file, not a
re-report of either of those.

**Remediation:** wrap the `fc.assert` call and its cleanup in a
`try`/`finally`, e.g.:
```js
try {
  await fc.assert(...);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  sharedRoot = undefined;
}
```
Given this is now the third occurrence of the identical class in one
session, worth a `rule_proposal` to the specifier for a durable lint/CI
gate (e.g. flag any `mkdtempSync`/`mkTmp(...)` fixture root not wrapped in
`try/finally` in its owning test file) — filed separately, alongside this
bounce, per role instructions on doing both.

## Everything else checked — genuinely clean (Article 4.4 full inventory)

| Check | Result |
|---|---|
| Dependency gate (`extension/out/tools/dependency-gate.js`, run from `extension/`) | PASSED — no forbidden edges |
| Co-change report | No new suspected coupling — pre-existing structural coupling in this well-known shared file pair only |
| `npm run compile` (from `extension/`) | Clean |
| `telegramFrontDeskBotCli.test.js` / `telegramFrontDeskBotCore.test.js` | 714/714 pass, including 5 new BL-1203 unit tests |
| `telegramFrontDeskBotCli.property.test.js` (BL-1203 properties) | 2/2 pass, non-vacuity documented and plausible (naive single-scalar dedup and the pre-fix "skip write if fits inline" shape both independently break each property, per commit message) |
| Acceptance (`run_acceptance.sh` on the BL-1203 feature) | 2/2 pass |
| Declared invariant 1 (at most one note per inbound identity) | Encoded as a real property test against the impure `enqueueRoleAnswerNote`, keyed on `updateId` history not a single scalar — correctly avoids the interleaved-replay false-negative the ticket's own constraints warn about |
| Declared invariant 2 (pointer file always matches the announced answer) | Encoded as a real property test; fix correctly makes `writeRoleAnswerFile` unconditional (previously skipped for inline-fitting text, which is exactly why the stale 2026-08-22 pointer file survived under fresh short replies) |
| `updateId` threading (`deliverAskAnswer`, `processSteeringUpdate`, `captureRoleAnswer`) | Optional throughout, no existing call site broken; button-tap leg already had a real `updateId`, free-text leg uses `update.update_id` (same identity used elsewhere in the file for `postToBridge`'s own dedup) |

**The underlying dedup fix itself is solid, correctly scoped to the
ticket's constraints (keys on identity not content, never silences
delivery, both invariants non-vacuously proven), and well-verified** —
this bounce is narrowly about the new property test's own fixture-cleanup
safety, not a doubt about the fix's correctness. The root-cause
investigation is honestly reported as inconclusive (the ORIGINAL replay
trigger is not pinned) — that is explicitly acceptable per the ticket's
own approval_context, which anticipated this.

## Routing

Per Article 4.3, owning stage is **coder** — the property test is new
code this parcel introduced; the fix is mechanical (wrap in
`try`/`finally`, matching `bl1213ParcelRollbackGuardSteps.js`'s own
`cleanupFixtureState`-in-`finally` pattern already in this codebase).

By architect.
