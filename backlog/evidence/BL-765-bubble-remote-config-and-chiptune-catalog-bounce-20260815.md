# BL-765 architect bounce — 20260815

Commit reviewed: fe2e4b8ad5 (cleaner dedupe, on top of coder b0e59b604)

## Review inventory

Ran to completion before bouncing (Article 4.4): dependency-gate hard gate
(PASSED, no forbidden edges — `node extension/out/tools/dependency-gate.js
extension/src/bridge/bridgeServer.ts extension/src/bridge/letsTalkChiptunes.ts`),
co-change report (no new coupling beyond bridgeServer.ts's pre-existing hub
shape), all three `required_wiring` entries (confirmed present), the full
Android JVM unit suite (`./gradlew :app:testDebugUnitTest`, JDK 17 — 26
tasks, BUILD SUCCESSFUL, 0 failures across all XML reports), the full
`extension/test/bridgeServer.test.js` suite (99/99 passed after a fresh
`npm run compile` — the first run 404'd on `/lets-talk/chiptunes.json`
against a stale `out/`, not a real defect), and the full BL-765 acceptance
feature via `node specs/pipeline/cli.js
specs/features/BL-765-bubble-remote-config-and-chiptune-catalog.feature`
(8/8 scenarios green). Only one item survives the sweep.

## D1 — invariant-unencoded: BL-765 invariant 2 has no property test for the bubble-config payload, and the code it would have caught does not hold it

**Declared invariant (ticket YAML):** "Every remote-served payload is
versioned and validated before use; an unparseable or wrong-schema payload
is rejected whole, never applied field-by-field."

This ticket wires exactly two remote-served payloads:
`/lets-talk/chiptunes.json` (new) and `/lets-talk/bubble-config.json`
(extended from BL-763's single-field read to the full 8-field capability
document — required_wiring item 3). The chiptunes side gets this invariant
right and proves it: `BridgeClient.parseChiptunesCatalog` (BridgeClient.kt:259)
rejects the whole catalog (returns `null`) on any single malformed song, and
`BridgeClientChiptunesCatalogPropertyTest.kt` encodes it with four property
tests, including a "naive field-by-field parser would fail this property"
non-vacuity companion that names invariant 2 verbatim in its own class
doc-comment.

`BridgeClient.fetchBubbleConfig` (BridgeClient.kt:220-241) — the function
this ticket's own required_wiring item 3 extends — has no equivalent. It
parses each of the 8 capability flags independently:

```kotlin
val json = JSONObject(raw)
val features = json.optJSONObject("features")
BubbleConfigResult(
    ok = true,
    textTurns = features?.optBoolean("textTurns", true) ?: true,
    handsFree = features?.optBoolean("handsFree", true) ?: true,
    ... // 6 more fields, same shape
)
```

A payload with one wrong-typed field, e.g.
`{"features": {"textTurns": "not-a-bool", "holdMusic": false}}`, is not
rejected whole: `textTurns` silently defaults to `true` (org.json's
`optBoolean` fallback on type mismatch) while `holdMusic` still applies as
parsed from the same malformed document — literally "applied field-by-field",
the exact shape invariant 2 rules out, and the inverse of what the sibling
chiptunes parser in the same file does one page up.

`grep -rl "fetchBubbleConfig\|BubbleConfigResult"
android/app/src/test/` returns nothing — zero tests, property or example,
touch this function or data class anywhere in the suite. Per the Invariants
Review process, the missing test is the send-back on its own; I also hand-
verified because the violation was visible from the code already in front
of me for the missing-test check (not something I went looking for
separately), and it confirms the gap is live, not just an uncovered no-op.

Note: the BL-765 acceptance feature's `remote-config-02` Scenario Outline
("not valid JSON" / "missing features") does **not** cover this — it drives
the *bridge's* own `letsTalkBubbleConfig.ts` fallback (pre-existing,
BL-763, out of this ticket's diff), which already validates whole-document
before ever serving bytes. The gap is specifically in the *phone's*
independent parse of whatever bytes arrive over HTTP, which is what a
network-boundary invariant is for regardless of what the server currently
guarantees.

**Remediation:** extract the parse into a pure, `internal`-visible function
(`BridgeClient.parseBubbleConfig(raw: String): BubbleConfigResult?` or
equivalent — same shape as `parseChiptunesCatalog`) that validates the
`features` object's shape and every flag's type before building the result,
returning `null` (whole rejection) on any wrong-typed field or wrong-shaped
`features`, with `fetchBubbleConfig` falling back to the bundled-default
`BubbleConfigResult` on a `null` parse (same fallback shape invariant 1
already requires for missing/unreachable). Add a property test for it,
same shape as `BridgeClientChiptunesCatalogPropertyTest` — an all-valid
document round-trips, a single malformed field anywhere rejects the whole
document, plus a non-vacuity companion proving a naive per-field parser
would pass where the real one must not.

Blamed role: coder (producing role for `fetchBubbleConfig`'s extension).
