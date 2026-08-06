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
