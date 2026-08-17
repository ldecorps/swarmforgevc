# Bubble's pager renders the bundle's pages, without ever stranding Talk (BL-829)

BL-825 (slice A) decided *which* UI bundle Bubble should render — four
outcomes (FRESH/CACHED/STALE/BARE), nothing shown yet. This slice (B) is
what renders *from* that decision: the manifest names its pages, the
pager turns that list into entries beside the native Talk page, and every
failure mode along the way resolves to a stated reason rather than a
blank WebView.

This is the slice every other Bubble screen ticket (BL-775 Live, BL-831
Pipeline, BL-832 Health, BL-834 Host thinking) was waiting on: without a
host that can render *some* bundle page, they are four features with
nothing to open into.

## What stays native

Per BL-824's locked decision: the collapsed-bubble gestures, the overlay
window, the mic/talk engine, and the Talk surface itself are not
migrating to remote UI. This slice adds remote pages **beside** Talk. The
pager always opens on Talk, whatever the bundle offers.

## The manifest gains a page list

`GET /lets-talk/ui-bundle.json` — the same route BL-825 added, no new
route — now also serves `pages`: an array of `{ id, title, entryPath,
order }`. Same whole-or-nothing validation posture as the rest of the
manifest (BL-654 invariant 2): a present-but-malformed `pages` entry
rejects the *entire* manifest, never a partially-valid page list. An
*absent* `pages` key is not malformed — it parses to `[]`, so a
pre-BL-829 manifest (BL-825's own default/legacy shape) still parses on
both the bridge (`letsTalkUiBundle.ts`) and the phone
(`UiBundleResolver.parseUiBundleManifest`), which validate independently
of each other exactly as BL-825 established.

## The pure decision: `PagerListResolver`

`PagerListResolver.resolve` (pure Kotlin, no `android.*` type in its own
signature — Testability Boundary — Bubble, BL-769) turns a
`UiBundleResolver` outcome plus the manifest's page list into a
`PagerList`:

- **Talk is never returned data.** The caller always places
  `PagerEntry.Talk` at position 0 itself; `resolve` cannot omit it
  however malformed or adversarial the manifest is (BL-654 invariant 1).
- **BARE** collapses to Talk alone, with a non-null `bareReason` — never
  a null/blank placeholder the caller renders as nothing.
- **STALE** carries the manifest's pages, marked `PagerState.STALE`, so a
  later UI layer can flag them as unconfirmed the same way BL-825 flags a
  stale bundle.
- **An entry path that would let the WebView escape the bundle** —
  absolute, another origin (`://`), or containing a `..` segment — is
  dropped by `honouredPages` rather than trusted downstream. This is the
  pure half of the page allowlist: `resolvePageId` then refuses any page
  id not present in the (already-honoured) list, never fuzzy-matching.

## The device edge: `RemotePageHost`

`RemotePageHost` is the thin `android.*` edge — it owns only the WebView
render, never the allowlist decision. On a main-frame load failure it
never leaves a blank WebView: it swaps in a `TextView` naming the page
and stating a reason (BL-829 invariant 3). `resolveUrl` (its one pure,
directly-unit-tested piece) joins the bridge base URL and the manifest's
`entryPath`.

## Wiring: `TalkPanelActivity` → `TalkPagerAdapter` → `RemotePageHost`

`TalkPanelActivity` is where the pager actually lives — **not**
`MainActivity`, despite the ticket's own `required_wiring` citing it.
`MainActivity` is the pairing-only screen; it is never shown again once
paired, so a host instantiated there would be exactly the unreachable-host
shape BL-419 exists to catch. What `MainActivity.startBubbleService()`
does is start `OverlayService`, which is what makes expanding the bubble
(→ `TalkPanelActivity` → `TalkPagerAdapter` → `RemotePageHost` per remote
page) reachable at all — the code comments on both classes record this
correction inline; the coder raised it as a note rather than treating it
as license to skip the wiring check.

`TalkPanelActivity.currentPagerList` calls `PagerListResolver.resolve`
against `TalkEngine.latestUiBundleResolution` (BL-825's stashed result).
A resolution not yet available — sync still in flight, or never run —
is treated the same as `BARE` (Talk alone), never as "no pages" silently
rendered as `NORMAL`. `TalkPagerAdapter` is a plain
`RecyclerView.Adapter`, not `FragmentStateAdapter`: since
`PagerListResolver` already decided the page list once before the
adapter is built, there is no Fragment-level state to restore. Position 0
is always the Talk page; every position after it is a
`RemotePageHost`-backed WebView page.

## Where it lives

- **Bridge:** `extension/src/bridge/letsTalkUiBundle.ts` (the `pages`
  field, `isValidPage`/`isValidPageList`, `hasValidManifestFields` now
  splits into `hasValidCoreManifestFields` + `hasValidPagesField`).
  `extension/src/bridge/letsTalkRoutes.ts` documents that the same route
  now carries both the bundle and its page list — there is no separate
  pages route.
- **Android pure logic:** `PagerListResolver.kt`
  (`android/app/src/main/java/com/swarmforge/floatcompanion/`).
- **Android device edge:** `RemotePageHost.kt`, `TalkPagerAdapter.kt`,
  wired from `TalkPanelActivity.kt`. Layouts: `remote_page.xml` (one
  WebView + failure `TextView`), `talk_panel_page.xml` (the old
  `activity_talk_panel.xml` content, now page 0 of the pager rather than
  the activity's own root).
- **Manifest parsing (phone):** `UiBundleResolver.kt`
  (`UiBundlePage`, `parsePage`/`parsePages`), `BridgeClient.kt`
  (`writeCachedUiBundleManifest` now serializes `pages` into the cache
  file too).
- **Tests:** `PagerListResolverTest.kt` plus one property test per
  decision (`PagerListResolverTalkAlwaysFirstPropertyTest`,
  `PagerListResolverPageAllowlistPropertyTest`,
  `PagerListResolverBareReasonPropertyTest`),
  `RemotePageHostResolveUrlTest.kt` — `./gradlew :app:testDebugUnitTest`.
  Bridge-side: `extension/test/letsTalkUiBundle.test.js`,
  `extension/test/letsTalkUiBundlePagesWholeOrNothing.property.test.js`.
- **Acceptance:**
  `specs/features/BL-829-bubble-remote-page-pager.feature` (manifest
  scenarios run against the real bridge; the pager-decision scenarios
  bind through the BL-769 seam to the JVM unit suite via
  `specs/pipeline/steps/bl829BubbleRemotePagePagerSteps.js`, with an
  explicit `KNOWN_VALUES` map from each Gherkin decision to its covering
  test — no passthrough check, BL-233).

## Testability boundary

Per BL-769: `PagerListResolver`'s decision (ordering, dropping
unhonourable entries, degraded-state selection, the allowlist) is pure
and runs under the JVM suite, no emulator. `RemotePageHost`'s WebView
render and the pager swipe gesture are device surface, verified by the
recorded manual procedure below. No Kotlin mutation/CRAP/DRY tool is
pinned in this project (constitution Startup Tools table) — the `.kt`
half runs the degraded unit-test-gap fallback; the TypeScript bridge half
stays in normal mutation scope.

## Verifying the device edge (recorded manual procedure)

With a bundle serving at least one page:

1. Expand Bubble. **Expect:** it opens on Talk, and the remote page is
   reachable by swipe.
2. Open the remote page. **Expect:** it renders; Talk is still reachable
   by swiping back.
3. Serve a manifest whose page entry points at a path that does not
   exist. Reopen. **Expect:** a stated reason on that page, never a blank
   view, and Talk unaffected.
4. Stop the bridge and reopen. **Expect:** the cached bundle's pages,
   marked stale, with Talk working.
5. Clear app data with the bridge down and open Bubble. **Expect:** Talk
   alone, with a plain statement that screens are unavailable.

## Not in this slice

The bundle resolver itself, its versioning, caching, and validation
(BL-825). The APK update prompt (slice C). The content of any individual
page — each screen ticket (BL-775, BL-831, BL-832, BL-834) owns its own
page; this slice ships with at least one page rendering end to end but
does not spec what it shows. Migrating Talk, the mic pipeline, the
overlay window, or the collapsed-bubble gestures to remote UI. Offline
authoring or editing of bundles.
