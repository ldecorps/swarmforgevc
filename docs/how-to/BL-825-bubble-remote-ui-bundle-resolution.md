# Bubble decides which UI bundle to render, without ever losing Talk (BL-825)

Bubble's screens are compiled into the APK today, so shipping a UI change
means a sideload and a reinstall. This slice does not change what Bubble
renders yet — the pager screens and the APK update prompt are later slices
(B and C) of epic `bubble-thin-shell`. It builds the decision every later
slice depends on: given what the bridge served this session, what is
cached on the device, and which shell (APK) is installed, which UI bundle
does Bubble render — and what does it fall back to when the honest answer
is "none of them"?

## The four outcomes

`UiBundleResolver.resolve` (pure Kotlin, no `android.*` type in its own
signature — the Bubble testability boundary, BL-769) classifies every call
into one of four outcomes:

| outcome | when | what would be shown |
| --- | --- | --- |
| **FRESH** | the served bundle is usable and newer than the cached one | the new content, no reinstall |
| **CACHED** | nothing newer was served (or the served bundle was rejected) | the last known-good bundle, presented as current |
| **STALE** | the bridge could not be reached at all, and a cached bundle exists | the cached bundle, explicitly marked unconfirmed |
| **BARE** | no usable bundle exists from either source | native Talk only, with a plain statement that screens are unavailable |

A fifth case cuts across the table rather than adding a row: a bundle whose
`minShellVersion` exceeds the installed shell's `BuildConfig.VERSION_CODE`
is never returned as FRESH, no matter how new it is — it falls through to
CACHED (if a compatible cached bundle exists) or BARE, carrying a non-null
`shellBehindReason` that a later slice turns into an update prompt.
Rendering a bundle the shell can't honour is how a remote-UI app bricks
itself on a phone the human can't easily reach.

`resolve` always returns cleanly — no exception path — so a caller can
always fall back to native Talk, and it never reports a stale cached
bundle as current (BL-654 invariants 1 and 3).

## Whole-or-nothing parsing

`UiBundleResolver.parseUiBundleManifest` rejects a manifest missing or
mistyping any of `schemaVersion`, `bundleVersion`, `minShellVersion`, or a
non-empty string `payload` — the whole document, never a partially-filled
one (BL-654 invariant 2, same posture as `BridgeClient.parseBubbleConfig`
and `parseChiptunesCatalog`, BL-765). The bridge-side parser in
`letsTalkUiBundle.ts` applies the same shape check to what it serves; the
phone re-validates independently rather than trusting the bridge's own
check.

## Where it lives

- **Bridge route:** `GET /lets-talk/ui-bundle.json` (`letsTalkUiBundle.ts`,
  wired into `bridgeServer.ts`'s `buildJsonRoutes`) — same sibling
  mechanism as `bubble-config.json`/`chiptunes.json`: an operator-pushed
  file under `.swarmforge/operator/` (`lets-talk-ui-bundle.json`), a
  rollback copy (`lets-talk-ui-bundle.rollback.json`), and the same
  `LETS_TALK_UI_BUNDLE_DISABLED` / `LETS_TALK_UI_BUNDLE_FORCE_ROLLBACK` /
  `LETS_TALK_UI_BUNDLE_PATH` / `LETS_TALK_UI_BUNDLE_ROLLBACK_PATH` env-var
  posture as its siblings, so an operator can push and instantly roll back
  a bundle the same way they already can a capability flag. Absent or
  malformed, it serves a default empty manifest (`bundleVersion: 0`) rather
  than an error.
- **Phone fetch + device cache:** `BridgeClient.fetchUiBundleManifest`
  (distinguishes an unreachable bridge, `reachable = false`, from a
  reachable one that answered with an error or a malformed body,
  `reachable = true, ok = false` — the distinction `resolve`'s
  STALE-vs-CACHED split depends on) and
  `readCachedUiBundleManifest`/`writeCachedUiBundleManifest` (one
  atomically-written file, `ui-bundle-cache.json`, same temp-file-then-rename
  pattern as `CompanionPackageStore`, BL-907). Only a FRESH outcome
  overwrites the cache, so a rejected/stale/bare fetch never overwrites the
  last known-good bundle with anything less than a confirmed newer one.
- **The real caller:** `BridgeClient.resolveUiBundle`, called from
  `TalkEngine.syncUiBundle()`, on the same pair/resume cadence
  (`OverlayService.onCreate`) as `syncBridgeInstanceAndSession()` and
  `syncChiptunesCatalog()`. Its result is stashed on
  `TalkEngine.latestUiBundleResolution` for a later slice to read — this
  slice decides, it does not yet render.
- **Tests:** `UiBundleResolverTest.kt`, plus one property test per BL-654
  invariant (`UiBundleResolverNeverThrowsPropertyTest`,
  `UiBundleResolverEvidenceConfidencePropertyTest`,
  `UiBundleResolverParseWholeOrNothingPropertyTest`,
  `UiBundleResolverKeepsCachedIntactPropertyTest`) —
  `./gradlew :app:testDebugUnitTest`. Bridge-side:
  `extension/test/letsTalkUiBundle.test.js`.
- **Acceptance:**
  `specs/features/BL-825-bubble-remote-ui-bundle-resolution.feature` (one
  Scenario Outline, six resolver decisions), bound through the BL-769 seam
  to the JVM unit suite by
  `specs/pipeline/steps/bl825BubbleUiBundleResolutionSteps.js`.

## Testability boundary

Per the Bubble testability boundary (BL-769), the resolver's own decision —
version comparison, whole-or-nothing parsing, the four-outcome
classification, the shell-behind refusal — is pure and runs under the JVM
suite with no emulator. The device edge (`fetchUiBundleManifest`'s HTTP
call, the file cache, the real pair/resume wiring) is device surface,
verified by the recorded manual procedure below rather than the JVM suite.

## Verifying the device edge (recorded manual procedure)

With Bubble paired to a live bridge:

1. Change a remote-only asset in the bundle on the host and redeploy the
   bridge. Reopen Bubble. **Expect:** `resolveUiBundle` returns FRESH.
2. Reopen again with nothing changed on the host. **Expect:** CACHED, no
   refetch churn.
3. Serve a deliberately malformed bundle. Reopen Bubble. **Expect:** the
   previous bundle's cache entry is untouched; the malformed one is
   discarded whole.
4. Stop the bridge. Reopen Bubble. **Expect:** STALE, with the cached
   bundle, and Talk still working.
5. Clear app data so no cache exists, bridge still down. Open Bubble.
   **Expect:** BARE, no crash loop.
6. Serve a bundle whose `minShellVersion` is above the installed shell.
   Reopen Bubble. **Expect:** that bundle not returned as FRESH; CACHED or
   BARE instead, carrying the shell-behind reason.
7. Confirm chiptunes and `bubble-config.json` still refresh as before
   (BL-765 regression check).

## Not in this slice

Rendering the actual remote pager screens (slice B — the pager still shows
today's native pages regardless of the resolver's outcome). The APK update
prompt and its download/install flow (slice C). Migrating Talk, the mic
pipeline, the overlay window, or the collapsed-bubble gestures to remote
UI — those stay native. Any signed/verified-payload scheme beyond schema
validation.
