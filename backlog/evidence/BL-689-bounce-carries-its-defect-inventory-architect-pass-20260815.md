# BL-689 architect pass — 2026-08-15

## Scope

Received from cleaner as `merge_and_process cleaner 19799375f3` (cleaner
forwarded the coder's commit unchanged — no cleanup needed). Reviewed commit
`19799375f3` ("BL-689: record-bounce carries its whole defect inventory", by
coder) fresh, from scratch, against Article 1.5 / architect.prompt's Review
Order.

Files reviewed (`git show --stat 19799375f3`):
- `extension/src/quality/qaBounce.ts` (new types/functions)
- `extension/src/tools/qa-bounce-line.ts` (optional 3rd arg)
- `extension/src/tools/record-bounce.ts` (wires the new flags)
- `extension/src/tools/recordBounceArgs.ts` (new flag parsing/degrade logic)
- `extension/test/bl689BounceCarriesDefectInventoryInvariants.property.test.js` (new)
- `extension/test/bounceStore.test.js`, `qaBounce.test.js`,
  `qaBounceLineCli.test.js`, `recordBounceCli.test.js` (extended)
- `specs/pipeline/steps/bl689BounceCarriesDefectInventorySteps.js` (new)
- `specs/pipeline/steps/index.js` (registration, 1 line)

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate (BL-259 hard gate)** —
   `node extension/out/tools/dependency-gate.js` against all 9 changed
   `extension/` files (4 src, 5 test) → "Dependency-rule gate PASSED: no
   forbidden edges." (The two `specs/pipeline/steps/*.js` files sit outside
   `extension/`'s scan root — same structural N/A as every other
   acceptance-harness parcel.)
2. **Co-change coupling (BL-255)** — ran `co-change-report.js` against the 4
   changed `extension/src` files plus the new step-handler file. All
   "SUSPECTED COUPLING" hits are within the bounce-recording feature family
   itself (`qaBounce.ts`, `record-bounce.ts`, `recordBounceArgs.ts`,
   `qa-bounce-line.ts`, `bounceStore.ts`/`qaBounceStore.ts`, their test
   files, and the sibling `bl635`/`bl454`/`bl688` step handlers) — exactly
   the ticket's own declared scope list. Nothing crosses into unrelated
   modules (webview/UI, other tool CLIs).
3. **Flag-grammar isolation (correctness read)** — confirmed by diff that
   `bounceArgsCore.ts`, `recordQaBounceArgs.ts`, and `record-qa-bounce.ts`
   (the legacy QA-only CLI) are untouched by this commit: `--items`/
   `--blocked` are added only to `recordBounceArgs.ts`'s own
   `RECORD_BOUNCE_FLAG_NAMES`, never to the shared `bounceArgsCore.ts`
   `FLAG_NAMES` the legacy CLI also uses. The legacy CLI's contract cannot
   have silently widened.
4. **`bounceStore.ts` left unmodified — verified this is correct, not a
   scope miss.** The ticket's own scope section names this file for
   "round-trip the new field," but `isBounceRecord`'s shape/value guards
   (`hasBounceRecordShape`/`hasKnownBounceValues`) only ever check the
   fields they know about and never strip unknown ones — `items`/`blocked`
   already survive `JSON.parse` → cast untouched, with no code change
   needed. `bounceStore.test.js` gained two new tests proving this round-trip
   holds (with and without an inventory) rather than assuming it — read and
   confirmed both are genuine (they call the real `appendBounceRecordIfNew`/
   `readBounceRecords`, not a mock).
5. **`formatBounceLine` backward compatibility** — the new `defectsPerBounce`
   parameter is optional and appended last; `qaBounceLineCli.test.js` gained
   an explicit test confirming a 2-arg call (the shape both `bl635` and
   `bl688`'s existing step handlers still use, confirmed by grep) produces
   byte-identical output to before this ticket.
6. **TypeScript compiles clean** — `npx tsc --noEmit -p extension` → no
   errors.

## Invariants Review (BL-633/654) — all three declared invariants

Ticket declares 3 invariants
(`backlog/paused/BL-689-bounce-carries-its-defect-inventory.yaml`):

1. A call with no inventory writes exactly the pre-ticket record shape.
2. One call is one bounce EVENT regardless of inventory size N.
3. A rejected/partially-invalid inventory never loses the bounce.

- All three have coder-authored, non-vacuous property tests in
  `bl689BounceCarriesDefectInventoryInvariants.property.test.js` (architect
  verifies existence/non-vacuity, does not author them — authorship
  correctly rests with coder here). All property tests drive the REAL CLI
  (`main()` from the compiled `record-bounce.js`) against a real temp git
  fixture repo and the real JSONL store — not a reimplementation of the
  CLI's own logic.
- **Invariant 1**: property test asserts the written record's key set is
  exactly the pre-BL-689 7 fields (`at,by,commit,failureClass,
  producingRole,ticket,ticketType`) across every `(role, class)` combination
  — matches `record-bounce.ts`'s own gate (`items`/`blocked` only assigned
  when `args.inventory.kind === 'ok'`). Non-vacuity: a record literal
  carrying a leaked `items: []` key is shown to fail the same key-set
  assertion.
- **Invariant 2**: property test records one call with `n ∈ [1,12]` items
  and asserts record count, `computeQaBounceTally.total`, and
  `computeBounceTallyByBouncingRole`'s summed count each rise by exactly 1,
  never by n. Non-vacuity: a `brokenTotal(before, n) = before + n` stand-in
  shown to diverge from the correct `+1`.
- **Invariant 3**: property test drives a generator over unparseable JSON,
  a non-array, an empty array, and invalid items (wrong/foreign `class`/
  `blamed` values, drawn from OUTSIDE their closed sets) and asserts, for
  every case: `recorded === true`, the correct `inventoryDegradeReason` is
  reported, exactly one record is written, and neither `items` nor
  `blocked` appears on it. Non-vacuity companion states the failure mode a
  broken (bounce-dropping) implementation would produce.
- No violation found on any of the three. No missing or vacuous property
  test found — nothing to record under `invariant-unencoded`.

## Property Testing pass (own section)

The property test file above already covers every pure function this
commit introduces or changes in a property-shaped way
(`isValidBounceInventoryItem`, `defectCountForRecord`,
`computeDefectsPerBounce`, `resolveBounceInventory`,
`resolveBlockedCount`) via the three declared-invariant properties, which
exercise them through the real CLI end-to-end rather than in isolation. No
additional undeclared-property gap found; nothing further to add.

## Tests re-run independently (all green)

- `npx vitest run --config vitest.properties.config.mjs bl689` (from
  `extension/`, after `npm run compile`) → 6/6 tests passed (3 invariant
  properties + 3 non-vacuity companions).
- `npx vitest run test/qaBounce.test.js test/bounceStore.test.js
  test/qaBounceLineCli.test.js test/recordBounceCli.test.js` → 4 files,
  119/119 tests passed, including real-subprocess exit-code checks for
  every degrade path.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-689-bounce-carries-its-defect-inventory.feature` →
  10/10 scenarios PASS (2 Scenario Outline example sets + 4 singles).

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. Clean pass — Article 4.4 explicit-NONE evidence, committed per the
BL-806 review-forward-evidence gate. Forwarding to hardener.

By architect.
