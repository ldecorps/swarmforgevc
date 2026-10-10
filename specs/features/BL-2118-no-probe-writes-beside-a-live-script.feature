Feature: BL-2118 No non-vacuity probe writes beside a live script

  A non-vacuity probe proves a test can fail by running it against a
  deliberately broken copy of the script under test. Nine test files
  wrote that copy inside the checkout, most of them beside the real script
  so that the copy's relative loads would still resolve, and removed it in
  a finally.
  A killed run skips the finally. At 06:35Z on 2026-09-25 a killed
  property run on the main checkout left bl1652's two broken copies in
  swarmforge/scripts/, and the next launch's script sync copied them into
  seven worktrees. A probe's broken copy now lives under a temporary root
  of its own, and the next probe reaps any root a dead run left behind.
  Split from BL-1743 on 2026-10-10: this is the last of three slices
  (BL-2116 the helper and bl1652, BL-2117 four extension/test probes), so
  its census covers all nine probe files.

  # BL-2118 no-probe-writes-beside-a-live-script-01 (moved verbatim from BL-1743)
  Scenario: no probe writes its broken copy beside a live script
    Given the probe census of test files and step handlers that write a broken copy of a script
    When each probe's broken-copy path is read
    Then no broken-copy path is under the checkout
    And the census names the 9 probe files counted at the 2026-10-07 re-census
