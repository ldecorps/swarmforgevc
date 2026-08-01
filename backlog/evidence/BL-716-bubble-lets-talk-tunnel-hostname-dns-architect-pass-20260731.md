# BL-716 architect pass — dns-05 fix reviewed, forwarded

## What was reviewed

Cleaner forwarded `0d06e1cb50` (merge of coder `3131ed8c07`, dns-05 discovery
fix: `swarmforge-bubble://pair` deep link, `PairingDeepLink.kt`, the Telegram
notify-side `buildBubblePairingDeepLink`, and the "Update Bubble pairing"
button on both the group-topic and private-DM message). This is the coder's
response to the D1 bounce in
`BL-716-bubble-lets-talk-tunnel-hostname-dns-bounce-20260731.md`.

## Checks run

- `node extension/out/tools/dependency-gate.js` on the two changed TS files:
  **PASSED**, no forbidden edges.
- `node extension/out/tools/co-change-report.js` on the changed files:
  expected clustering within the notify/bridge subsystem, nothing outside
  the touched files' natural neighborhood.
- Traced both button call sites (`syncResidentSpyTunnelUrl`'s group-topic
  path and `notifyResidentSpyTunnelUrl`'s private-DM path) — both thread
  `pairingDeepLink` through; no missed consumer.
- Traced the origin/token contract end to end: `buildBubblePairingDeepLink`
  emits `url=<origin>` (no path), matching `CompanionPrefs.save`/
  `BridgeClient`'s expectation of a bare origin as `baseUrl`. Confirmed
  `token` lookup falls back to `bearer` correctly, matching
  `buildResidentSpyMiniAppUrl`'s actual `?bearer=` param name (test already
  covers this).
- `npx vitest run test/residentSpyTunnelNotify.test.js`: 14/14 pass.
- Added `extension/test/residentSpyTunnelNotify.property.test.js` (my own
  commit, property-testing pass): origin/token round-trip through the
  deep-link query encoding across the input range, not just the four
  hand-picked examples. Verified non-vacuous (fails with the `token ??
  bearer` fallback removed, passes restored). `npx vitest run --config
  vitest.properties.config.mjs`: 32/32 files, 97/97 tests green.

## Invariants (3 declared)

Coder's `7c9e6db93` commit message states the non-encodability reason for
all three (Android runtime behavior, no JVM/Kotlin test seam reachable from
the Node property-test runner) and cites BL-761. Accepted — matches the
non-encodability hatch in this role's Invariants Review section.

## Acceptance-wiring gap — reviewed, NOT a send-back

Ran `node specs/pipeline/cli.js specs/features/BL-716-...feature` directly:
all 5 scenarios (dns-01..05) fail `no step handler matched` — the whole
feature file, not just dns-05. This looks bounce-worthy on its face (the
ticket's own `required_wiring` names `...feature::acceptance`), but I
checked it against `backlog/paused/BL-761-acceptance-contract-that-cannot-run-reaches-qa.yaml`
(human-approved, specifier-authored 2026-07-31) before treating it as a
defect:

- BL-761's own measurement table lists BL-716 by name at 0/5, explicitly
  annotated "NOT a defect: an unbuilt ticket legitimately has no handlers
  yet" (the defect class BL-761 targets is the four tickets that already
  shipped to `done/` with the same gap — BL-716 isn't one of them).
- BL-761's `approval_context` names the exact sequencing hazard: landing an
  enforcement gate before deciding "where Android device behavior's
  contract lives" would make the whole Bubble family (BL-716 included)
  unlandable over a policy question nobody has answered yet, and explicitly
  recommends resolving the policy question first. Bouncing BL-716 for this
  now would produce exactly the outcome BL-761's own approval_context warns
  against, at the architect gate instead of the CI gate BL-761 will add.
- Coder's commit message independently states the same reasoning and cites
  BL-761 by number — cross-checked, not just taken on assertion.

Disposition: accepted as known, ticketed, human-approved debt. Not this
parcel's or this review's to fix. Forwarded to hardener.

By architect.
