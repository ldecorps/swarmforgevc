Feature: BL-1976 The Babashka quality tools are vendored at pinned commits

  BL-472 slice 2 of 3. clj-mutate, crap4clj and dry4clj (github.com/unclebob)
  are pinned by commit in swarmforge.lock.json and vendored under
  swarmforge/vendor/, the way install_aps_tools.sh vendors the APS tools, so
  the hardener's gate (BL-1977) needs no network at run time. Their deps
  resolve through the pinned JVM toolchain BL-1975 installs.

  Background:
    Given the lock file pins clj-mutate, crap4clj and dry4clj each by repository and commit

  # BL-1976 the-tools-are-vendored-at-their-pins-01
  Scenario: the install vendors each tool at the commit the lock file names
    Given source repositories whose pinned commits exist
    When the quality tools install runs
    Then each tool is vendored at the commit the lock file names

  # BL-1976 a-second-install-changes-nothing-02
  Scenario: running the install again changes nothing
    Given the tools are already vendored at their pinned commits
    When the quality tools install runs
    Then the vendored tools are unchanged

  # BL-1976 a-checkout-that-misses-its-pin-vendors-nothing-03
  Scenario: a tool whose checkout is not at its pinned commit is not vendored
    Given a source repository whose checked-out commit is not the pinned one
    When the quality tools install runs
    Then the install exits non-zero naming that tool
    And that tool is not vendored
