# mutation-stamp: sha256=5a885eb0d8fa70e460c0f4ba8b95ebe332357925cf757dde960382fadff6b935
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-17T01:49:37.630285Z","feature_name":"Bubble decides which UI bundle to render without ever losing its Talk surface","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-825-bubble-remote-ui-bundle-resolution.feature","background_hash":"c23bd1348caf861a59da975037237b60841e59bddd56bf51d813886c8fc1feae","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the bundle resolver's decision is covered by the JVM unit suite","scenario_hash":"4d84f9ebd712939a662abaa601ab32769c391e2aacdc85c1ed04521f9ab6c78c","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-17T01:49:37.630285Z"}]}
# acceptance-mutation-manifest-end

Feature: Bubble decides which UI bundle to render without ever losing its Talk surface

  Bubble's screens are compiled into the APK today, so every UI change costs a
  sideload and a reinstall. The bridge will serve a versioned UI bundle instead,
  the way it already serves bubble-config.json and chiptunes.json. This slice is
  the decision that sits in front of that fetch: given what the bridge served,
  what is cached, and which shell is installed, which bundle does Bubble render
  — and what does it fall back to when the answer is "none of them".

  That decision is pure logic with no android.* type in its own signature, so
  per the constitution's Testability Boundary — Bubble it is verified by the JVM
  unit suite that runs with no emulator and no connected device. The WebView
  render, the overlay and a real fetch over a live tunnel are device surface and
  are verified by the manual procedure recorded in BL-825, not here.

  Background:
    Given the Bubble Android module

  # BL-825 bubble-remote-ui-bundle-resolution-01
  Scenario Outline: the bundle resolver's decision is covered by the JVM unit suite
    When the JVM unit suite is run
    Then it exercises <decision>

    Examples:
      | decision                                                              |
      | rendering a served bundle that is newer than the cached one           |
      | keeping the cached bundle when the served bundle is not newer         |
      | rejecting a malformed bundle whole and keeping the last good one      |
      | refusing a bundle whose minimum shell version exceeds the installed shell |
      | falling back to the native Talk surface when no bundle is available   |
      | marking the rendered bundle stale when the bridge is unreachable      |
