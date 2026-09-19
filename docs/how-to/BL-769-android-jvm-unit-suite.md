# Running Bubble's JVM unit suite (BL-769)

Bubble (`android/`) has a JVM unit test source set: pure Kotlin logic, run on
the host JVM, with no emulator and no connected device.

## Run it

```bash
cd android
# one-time: point Gradle at the Android SDK (see BL-707's how-to for the
# portable JDK 17 + SDK setup); local.properties is gitignored
printf 'sdk.dir=%s\n' "/path/to/.swarmforge/android-sdk" > local.properties
./gradlew :app:testDebugUnitTest
```

No emulator running and no device attached (`adb devices` empty) is required
— this task never touches `androidTest/` or any instrumented runner.

Reports land under `android/app/build/reports/tests/testDebugUnitTest/` (HTML)
and `android/app/build/test-results/testDebugUnitTest/` (JUnit XML, what the
acceptance steps in `specs/pipeline/steps/bl769AndroidPureLogicJvmUnitSeamSteps.js`
read).

## Where a new Bubble test belongs

Every Bubble behavior lands on one side of a line:

- **Pure logic** — no `android.*` framework type in the function's own
  signature (parsing, classification, data transforms). Goes under
  `android/app/src/test/java/com/swarmforge/floatcompanion/`, plain JUnit,
  gated by `testDebugUnitTest` above. Two examples already there:
  `PairingDeepLinkTest.kt` (deep-link parsing, via `java.net.URI` instead of
  `android.net.Uri` — see `PairingDeepLink.kt`'s BL-769 note) and
  `BridgeClientTest.kt` (the BL-716 connection-failure classification).
- **Device-surface behavior** — Activities/Services as running components,
  the overlay window, audio capture/playback, real network I/O against a live
  tunnel. Not reachable by this JVM suite (and not by the Node acceptance
  runner either, which cannot execute Kotlin at all). Verified by a recorded
  manual procedure instead — see the relevant feature's own `notes:` /
  approval evidence for what that procedure is until a further ticket lands
  a standing template for it.

When a change straddles the line (e.g. `PairingDeepLink.parse` used to take
`android.net.Uri`), push the framework type to the caller (an Activity
converts `Uri` → `String` at the one call site) rather than pulling a test
harness like Robolectric in — this keeps the suite fast enough to run on
every parcel.

`local-engineering.prompt` naming the Android device surface as
environmentally unsuitable (alongside the VS Code API and the webview) and
stating where device behavior is verified instead is a separate,
specifier-owned deliverable (see BL-769's ticket `approval_context`) — this
document covers the seam itself, not that policy text.

## The source charset must be pinned, not inherited (BL-1635)

`org.gradle.jvmargs=-Dfile.encoding=UTF-8` in `gradle.properties` pins only
the Gradle daemon's own JVM. The Kotlin compile daemon is a separate JVM
and, unset, inherits whatever locale the process that first started it
happened to have — under an automated caller with no `LANG` at all (the
acceptance handlers' Gradle lib spawns with only `PATH`/`HOME`), that
daemon's default charset follows JDK 17's locale-derived `file.encoding`
(JEP 400's UTF-8-by-default only lands in JDK 18+), so a test source set
recompiled by such a daemon can silently decode a UTF-8 literal (e.g. an
em-dash) wrong while `main` classes compiled earlier under a different
daemon invocation stay correct — two compiles, two charsets, one
repository, and a `ComparisonFailure` with no code change. Three lines now
pin every JVM this build touches regardless of caller environment:
`kotlin.daemon.jvmargs=-Dfile.encoding=UTF-8` and
`systemProp.file.encoding=UTF-8` in `gradle.properties`, plus
`compileOptions { encoding = "UTF-8" }` in `app/build.gradle.kts` for
`javac`'s own source-reading charset. If `:app:testDebugUnitTest` ever
shows a string-literal mismatch with no corresponding source change,
suspect the calling environment's locale before the test.
