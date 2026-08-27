# Hotfix record: 2026-08-02 Bubble pairing + client-logs

On 2026-08-02 the operator shipped a working Bubble pairing and client-log
path by hand: a pre-auth `/pair` page on the bridge (`intent://` link with
copy fallbacks, replacing a bare custom-scheme auto-redirect), a
`PairingSave`-shaped merge fix so a blank field never overwrote a stored
credential, an `AppLog` ring-buffer + "Copy logs" Settings button, and an
`applicationId` rename to escape a signing-key clash. It was functional and
in production, but ticket-less and unreviewed. This is that review, adopted
under BL-788 (BL-506 adopt-and-review posture — this is that pass, not a
revert).

## What BL-788 adopted, with corrections

By the time this was reviewed the tree had moved well past the 2026-08-02
snapshot the ticket was written against — later, properly ticketed work had
already absorbed or superseded most of it. BL-788 adopted what was still
genuinely missing rather than replaying a stale diff:

- **`extension/src/bridge/bridgeServer.ts`** — a new pre-auth `/pair` page
  (query-token gated, same pattern as the sideload APK route): renders a
  plain, clickable `intent://pair?...#Intent;scheme=swarmforge-bubble;
  package=<applicationId>;end` link plus copyable bridge-URL/token text, and
  never auto-navigates (no `<meta http-equiv="refresh">`, no bare
  `swarmforge-bubble://` redirect). The sideload APK route's pre-auth guard
  was also widened: any request under the `/swarmforge-float-companion`
  namespace prefix is now claimed and 404'd if it doesn't match the strict
  filename pattern, instead of falling through to the generic 401 gate —
  previously safe only by coincidence (nothing else happened to match
  either), not because the route deliberately rejected it.
- **`extension/src/concierge/residentSpyTunnelNotify.ts`** —
  `buildBubblePairingHttpsUrl` / `ResidentSpyTunnelUrls.pairingHttpsUrl`: an
  HTTPS `/pair` URL on the tunnel's own origin, addable to the existing
  pairing-deep-link notification without replacing it.
- **`android/.../PairingSave.kt`** (new) + **`PairingSaveTest.kt`** (new,
  six JVM unit tests) — the pairing merge decision: a blank input field
  never overwrites a stored non-blank credential. `CompanionPrefs.save` now
  delegates to it; previously it wrote whatever it was handed unconditionally,
  including a blank value from a field the human hadn't finished retyping.
- **`specs/features/BL-788-bubble-pairing-client-logs-adopt.feature`** +
  step handlers — pins the parts that run in this repository's Node
  acceptance runner (the pairing page, the APK route, the tunnel
  notification's pairing URL). Android device behaviour is deliberately
  absent (BL-761/BL-769): `AppLog`'s Settings button, the overlay, and the
  deep-link apply path cannot bind to a step handler here.

## Corrections the review did not wave through

1. **`applicationId` rename — not carried forward.** The ticket's own
   sign-off item asked to confirm a rename from `com.swarmforge.floatcompanion`
   to `com.swarmforge.bubble` as permanent. It wasn't: a *later* hotfix
   (independent of this one) renamed it again, to `com.swarmforge.float`, to
   escape a signing-key clash after the Linux → Mac host switch —
   `android/app/build.gradle.kts` documents this in its own comment. Renaming
   it a third time here would revert real, already-landed, deliberate
   operator work for no reason connected to this ticket. The `/pair` page's
   `intent://` link names whatever `applicationId` is *actually* current
   (`com.swarmforge.float` today), read from `build.gradle.kts` by a
   coder-authored property test
   (`extension/test/bl788BubblePairingInvariants.property.test.js`,
   invariant 2) so a future rename can't silently drift the two apart again.
2. **Release signing decision — moot.** The ticket's other sign-off item
   asked whether a debug-signed `release` build type was deliberate or an
   accident. It's neither: `android/scripts/publish-apk.sh` (unchanged by
   this ticket) publishes the **debug** build
   (`app/build/outputs/apk/debug/app-debug.apk`), not `release`, and
   `build.gradle.kts`'s `release` block carries no `signingConfig` at all.
   Standard debug-key signing on a debug build needs no recorded decision.
3. **Local-engineering Architecture Rule 7 — already rewritten.** The ticket
   asked to correct a parenthetical claiming the `floatcompanion` package id
   "may stay." That text no longer exists: rule 7 was rewritten by a later,
   unrelated amendment (Telegram/Cursor naming policy) and says nothing
   about package ids today. Nothing to correct.
4. **`AppLog` / client-logs UI — not adopted in this pass.** The ring buffer,
   logcat tag, and Settings "Copy logs" button named in the original hotfix
   are not in this tree. Unlike the pairing fix above, nothing in BL-788's
   acceptance scenarios, `required_wiring`, declared invariants, or its own
   e2e QA procedure references them — only the historical narrative does.
   Building an unreferenced, ungated feature risked exactly the
   inert-contract failure mode BL-761/BL-769 exist to prevent (a device-only
   feature with no runnable binding and no manual-verify procedure
   recorded). Left for a follow-up ticket that states its own acceptance
   contract, per BL-769's Testability Boundary (a pure-logic ring buffer
   would be JVM-testable; the Settings wiring and logcat write would need a
   recorded manual procedure).

## Verify

```bash
npx vitest run test/bridgeServer.test.js test/residentSpyTunnelNotify.test.js
npm run test:properties -- test/bl788BubblePairingInvariants.property.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-788-bubble-pairing-client-logs-adopt.feature
JAVA_HOME=<jdk-17> ./gradlew -p android :app:testDebugUnitTest --tests "*.PairingSaveTest"
```

Acceptance feature:
`specs/features/BL-788-bubble-pairing-client-logs-adopt.feature`.
