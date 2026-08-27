# Bubble's capability flags and hold-music catalog, served from the bridge (BL-765)

Bubble used to hard-code its capability set and its hold-music song list in
the APK, so turning a feature off or adding a tune meant building,
publishing, and installing a new APK on the phone. Both now come from the
bridge instead, and Bubble falls back to its bundled defaults whenever a
document is missing, unreachable, or malformed.

## The two documents

- **`GET /lets-talk/bubble-config.json`** (`letsTalkBubbleConfig.ts`) — a
  versioned capability document: `schemaVersion`, `revision`, and a
  `features` object with eight boolean flags — `textTurns`, `handsFree`,
  `holdMusic`, `playlist`, `newSession`, `pauseAll`,
  `bridgeBounceAutoSessionReset`, `voiceEngineSwitch`. BL-763 wired this
  route but only ever read `bridgeBounceAutoSessionReset`; this ticket makes
  Bubble apply the other seven.
- **`GET /lets-talk/chiptunes.json`** (`letsTalkChiptunes.ts`) — the
  hold-music catalog as data: a `version`, a `format`, and a list of songs
  (`name`, `bpm`, MIDI `steps`). The module and its ~3.5k-line catalog
  landed earlier (f175bc56d) but nothing served or fetched it until now.

Bubble fetches both on pair/resume (`OverlayService.onCreate`).

## Behaviour

1. **Whole-document rejection, not field-by-field.** Both parsers reject an
   unusable payload as a whole rather than applying the parts that happen to
   look valid — a missing/non-object `features` (or catalog `songs`), or any
   single flag/song holding the wrong shape, throws out the entire document.
   `BridgeClient.parseChiptunesCatalog` and `BridgeClient.parseBubbleConfig`
   (`BridgeClient.kt`) share this shape; each returns `null` on any
   malformed field, and their callers fall back to the bundled default
   rather than applying a partially-parsed result.
   - This was an architect bounce on the first pass:
     `fetchBubbleConfig` originally parsed each of the 8 flags
     independently via `optBoolean`'s type-mismatch fallback, so one
     wrong-typed flag silently defaulted to `true` while sibling flags from
     the same malformed document still applied — the inverse of invariant 2
     and of the sibling chiptunes parser one page up in the same file.
     `parseBubbleConfig` was extracted to close the gap.
2. **Bundled defaults on any failure.** An absent, unreachable, or malformed
   config leaves every capability enabled (`BubbleConfigResult`'s defaults);
   an unusable catalog leaves `HoldMusicPlayer`'s hardcoded song list in
   place. Bubble never renders an empty or broken surface because a remote
   document was bad.
3. **A remote disable overrides the user's own toggle.**
   `HoldMusicOffer.shouldOffer(holdMusicOn, pausedAll, capabilityEnabled)`
   requires all three — the user's on/off toggle, not being paused, *and*
   the remote `holdMusic` capability — so disabling `holdMusic` on the
   bridge removes the control even if the user had it on locally, with no
   APK change.
4. **A song added to the catalog reaches the phone on redeploy.** The
   catalog is served fresh on every fetch; a phone that successfully
   fetches an updated `chiptunes.json` sees the new song in its playlist
   with no reinstall.
5. **Hold-music volume no longer governs the reply voice.** Lowering the
   music-volume slider now only affects hold music; the reply voice plays
   at full gain regardless (`ReplyGain.independentOfMusicVolume`) instead of
   sharing one control with hold music.
6. **Version label.** The debug version string on the pairing screen and
   talk panel dropped its stale `BL-707` prefix; it now just reads
   `v<version>`.

## Where it lives

- Bridge routes: `letsTalkBubbleConfig.ts` (`GET
  /lets-talk/bubble-config.json`, pre-existing from BL-763),
  `letsTalkChiptunes.ts` (`GET /lets-talk/chiptunes.json`, wired into
  `bridgeServer.ts`'s `buildJsonRoutes` by this ticket).
- Phone fetch + whole-document parsing: `BridgeClient.kt` —
  `fetchBubbleConfig`/`parseBubbleConfig`,
  `fetchChiptunesCatalog`/`parseChiptunesCatalog`.
- Pure decision logic (no `android.*` type in its own signature, JVM-unit-
  tested): `HoldMusicOffer.kt` (`shouldOffer`), `ReplyGain.kt`
  (`independentOfMusicVolume`).
- Device wiring: `OverlayService.kt` (fetch on pair/resume),
  `HoldMusicPlayer.kt` (catalog swap-in / fallback), `TalkEngine.kt`
  (capability gating, volume wiring), `TalkPanelActivity.kt` /
  `MainActivity.kt` (version label).
- Tests: `BridgeClientBubbleConfigPropertyTest.kt`,
  `BridgeClientChiptunesCatalogPropertyTest.kt`,
  `HoldMusicPlayerPropertyTest.kt`, `HoldMusicOfferPropertyTest.kt`,
  `ReplyGainPropertyTest.kt` — each includes a non-vacuity companion
  proving a naive per-field parser would wrongly accept a document the real
  parser rejects. `./gradlew :app:testDebugUnitTest`.
- Acceptance:
  `specs/features/BL-765-bubble-remote-config-and-chiptune-catalog.feature`
  (8 scenarios), driven by
  `specs/pipeline/steps/bl765BubbleRemoteConfigChiptuneCatalogSteps.js`
  against the real compiled bridge server and the JVM unit suite.

## Testability boundary

Per the Bubble testability boundary (BL-769), only the device-surface wiring
that fetches, swaps in, and renders is untested by anything but manual
procedure. Everything the two documents *decide* — whole-vs-partial
rejection, whether hold music is offered, whether the reply voice tracks
music volume — is pure and runs under the JVM suite with no emulator.

## Out of scope

Shared-token inbound fan-out and bridge liveness (BL-764). Bridge bounce
detection / `GET /lets-talk/meta` and Cursor Remote always-on (BL-763).
Tunnel hostname discovery (BL-716). Migrating Live Screen from the Mini App
to Bubble.
