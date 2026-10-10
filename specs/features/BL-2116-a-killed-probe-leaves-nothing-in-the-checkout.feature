Feature: BL-2116 A killed non-vacuity probe leaves nothing in the checkout

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
  Split from BL-1743 on 2026-10-10: this slice builds the shared
  temporary-root helper and converts bl1652; BL-2117 and BL-2118 convert
  the other eight probe files.

  # BL-2116 a-killed-probe-leaves-nothing-behind-02 (moved verbatim from BL-1743)
  Scenario: a probe killed before its cleanup leaves nothing in the checkout
    Given a probe that has written its broken copy in a child process
    When the child process is killed before its cleanup runs
    Then no path carrying the child's pid is under the checkout
    And the next probe run reaps the dead child's temporary root
