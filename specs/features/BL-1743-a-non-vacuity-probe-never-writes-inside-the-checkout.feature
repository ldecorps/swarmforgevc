Feature: BL-1743 A non-vacuity probe never writes inside the checkout

  A non-vacuity probe proves a test can fail by running it against a
  deliberately broken copy of the script under test. Eight test files
  wrote that copy inside the checkout, most of them beside the real script
  so that the copy's relative loads would still resolve, and removed it in
  a finally.
  A killed run skips the finally. At 06:35Z on 2026-09-25 a killed
  property run on the main checkout left bl1652's two broken copies in
  swarmforge/scripts/, and the next launch's script sync copied them into
  seven worktrees. A probe's broken copy now lives under a temporary root
  of its own, and the next probe reaps any root a dead run left behind.

  # BL-1743 no-probe-writes-beside-a-live-script-01
  Scenario: no probe writes its broken copy beside a live script
    Given the probe census of test files and step handlers that write a broken copy of a script
    When each probe's broken-copy path is read
    Then no broken-copy path is under the checkout
    And the census names the 8 probe files counted at mint

  # BL-1743 a-killed-probe-leaves-nothing-behind-02
  Scenario: a probe killed before its cleanup leaves nothing in the checkout
    Given a probe that has written its broken copy in a child process
    When the child process is killed before its cleanup runs
    Then no path carrying the child's pid is under the checkout
    And the next probe run reaps the dead child's temporary root
