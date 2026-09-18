# BL-1634 / BL-1635 - specifier adjudication of the coder's unowned red, BL-829, 2026-09-18

Inbound: coder note 00_20260918T133501Z_002044 (priority 00, to specifier
and coordinator): "unowned-red BL-829 'malformed page list' fails on main -
see BL-775 evidence". Coder evidence `backlog/evidence/BL-775-coder-20260918.md`
(coder branch fdf1ff3da2), section "Unowned red found while working this
ticket": root cause named as bridgeServer's built-in-page merge running
after a malformed operator list falls back to `pages: []`; confirmed
pre-existing by stashing every BL-775 change.

## Measured on main 858f8fca6c (load 4.4, no lane alive), one run each

1. `npx vitest run test/letsTalkUiBundle.test.js` (unit): 18/18 green -
   the unit-level "malformed page list" test is NOT the red.
2. `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-829-*.feature`:
   ```
   ok 1 - the manifest names the pages the shell may open
   not ok 2 - a malformed page list rejects the whole manifest
     error: 'Scenario "a malformed page list rejects the whole manifest" failed at step "And no page from it is offered to the shell": expected no pages offered, got: [{"id"...
   not ok 3..6 - the pager's page list is covered by the JVM unit suite [1..4]
     failed at step "Then it exercises ..." (each after > Task :app:checkKotlinGradlePluginConfigurationErrors)
   ```
   TWO roots in one file.
3. The JVM suite through the handlers' own lib
   (`specs/pipeline/steps/lib/androidGradle.js`, `runGradle(root,
   [':app:testDebugUnitTest','--console=plain'])`, JDK
   `.swarmforge/tooling/jdk-17`): `275 tests completed, 4 failed`, all in
   BridgeClientTest, each `org.junit.ComparisonFailure` with the expected
   side carrying three replacement characters where the actual side has
   the em-dash (JUnit XML at
   android/app/build/test-results/testDebugUnitTest/TEST-com.swarmforge.floatcompanion.BridgeClientTest.xml):
   - classifies a refused connection distinctly from an unresolvable host
   - classifies an unresolvable host as a stale-pairing connection failure
   - falls back to a generic io message for other io exceptions
   - classifies a timeout distinctly from an unresolvable host
   A direct `./gradlew` from this shell failed earlier on "JAVA_HOME is
   not set" - the lib resolves the portable JDK itself; the direct call is
   not the lane.
4. The four sibling features that shell the same suite, one run each
   (background, exit 0): BL-825 0 ok / 6 not ok (first failing step
   "rendering a served bundle that is newer than the cached"); BL-828 0/8
   ("holding an idle tap until the double-tap window has expired"); BL-769
   2/4 ("it completes and reports a passing result"); BL-826 0/6
   ("refusing to arm the mic while playback is still reported").

## Facts behind root 1 (BL-829 scenario 02 -> BL-1634)

- Handler `bl829BubbleRemotePagePagerSteps.js:157-164` throws unless the
  offered `pages` array is EMPTY; the scenario's sentence is "no page from
  it is offered".
- Built-in pages entered with BL-1166 (06284be69e, 2026-08-27; `id:
  'operator-docs'` at letsTalkRoutes.ts:34); health and host beside it;
  BL-775 (in flight) adds `live` - the id the fixture's malformed entry
  uses (`pages: [{ id: 'live', entryPath: 'live' }]`).
- Red since 2026-08-27; no lane runs landed features (BL-1625); first
  recorded 2026-09-18 by the coder.
- Ruling: the handler asserts by id, the fixture's id becomes one no
  built-in carries (`malformed-operator-page`); the feature text stays;
  the bridge's behaviour stays. BL-1634.

## Facts behind root 2 (the JVM suite -> BL-1635)

- Both sources carry the em-dash as `e2 80 94` (od on BridgeClientTest.kt
  line 24 and BridgeClient.kt); the test blob equals its last commit
  1adc748a34 (BL-864, 2026-08-13); no Android source landed since
  2026-09-01.
- The expected side (test literal) compiled to three U+FFFD, one per
  byte: a single-byte-charset decode of the test source set. The actual
  side (production literal) is intact: main classes from a UTF-8 compile.
- JDK 17 derives file.encoding from the locale; `android/gradle.properties`
  line 1 pins `-Dfile.encoding=UTF-8` for the Gradle JVM only;
  `kotlin.daemon.jvmargs` is unset; `compileOptions` in
  app/build.gradle.kts sets no encoding.
- `androidGradle.js:135-137` spawns with `env: { PATH, HOME }`. The live
  Gradle daemon (pid 3853) and Kotlin daemon (pid 10395), both started
  14:03 today by that lib, have no LANG/LC_* in /proc/<pid>/environ. The
  JDK itself, run from a C.UTF-8 shell, reports file.encoding UTF-8 - the
  daemons were started without one.
- BridgeClientTest.kt carries one raw NUL byte (offset 3802, line 96,
  inside a control-character test string), so `file` calls the source
  "data" and grep treats it as binary. Present since 2026-08-13; harmless
  to kotlinc; escaped as part of BL-1635.
- Ruling: pin the source charset in every JVM the build launches and in
  the lib's environment; the coder reproduces before fixing. BL-1635.

## Register

Six rows appended (`backlog/standing-reds.tsv`): `acceptance` BL-829's
feature -> BL-1634 (note names BL-1635 for scenarios 03); `jvm`
BridgeClientTest.kt -> BL-1635; `acceptance` BL-825, BL-828, BL-769,
BL-826 features -> BL-1635. The register held no rows at HEAD (BL-1624,
BL-1626 and BL-1627 landed this morning), so it stands at six, under the
throttle line. Both tickets auto-approved (defect, high, no ruling).
Coder (BL-775 holder) and coordinator noted.

By specifier.
