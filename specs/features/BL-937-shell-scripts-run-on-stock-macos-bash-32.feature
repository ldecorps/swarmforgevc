Feature: every tracked shell script runs on the stock macOS /bin/bash 3.2 this repo targets

  # BL-937 (swarm-reliability). engineering.prompt is explicit: "Target
  # stock macOS /bin/bash 3.2, not Homebrew bash". Six tracked shell
  # scripts broke that target by using builtins and expansions bash 3.2
  # does not have, and on the host BL-937 was minted on - where /bin/bash
  # was the only bash - they could not run at all.
  #
  # Measured 2026-08-19 by invoking each one:
  #   test_handoffd_priority_rotate_wiring.sh   exit 127, mapfile (4 sites)
  #   test_handoffd_aged_note_rotate_wiring.sh  exit 127, mapfile (2 sites)
  #   test_handoffd_starve_rotate_wiring.sh     exit 127, mapfile (4 sites)
  #   smoke_check_stabilize_two_pack.sh         exit 127, mapfile (1 site)
  #   swarm_dashboard.sh <root>                 exit 1,   mapfile (1 site)
  #   reexpedite_from_wip.sh <root> <BL-id>     bad substitution, ${n^^}
  #                                             (2 sites) then mapfile (2)
  #
  # The three wiring tests were the sharp end: three handoffd rotation
  # gates that had never once executed on that host, their failure twice
  # written off in evidence files as "pre-existing and unrelated" (BL-795,
  # BL-911) without ever being ticketed.
  #
  # BL-1627: the runtime scenarios below (originally 01 and 03) asserted
  # `Given the stock system bash reports version 3.2` - a premise of the
  # HOST this swarm happened to run on when BL-937 minted, not of the
  # scripts under test. The swarm runs on WSL/Linux now, so that premise
  # fails everywhere this acceptance runner runs, proving nothing about
  # the scripts either way. Retired, not reworded, per BL-1006 (a
  # host-premise assertion frozen into a standing scenario stays true only
  # while the premise holds); the runtime checks they made live on as
  # macOS-only qa_e2e steps in BL-1627 instead. Scenario 02 - the pure
  # static construct scan, scanning code and never prose - is the standing
  # guard and holds on every host.
  #
  # Scenario 02 scans code, never prose: lifecycle_matrix.sh carries a
  # comment saying it deliberately avoids `declare -A`, and a scan that
  # read comments would fail on a file that is already correct. The
  # construct list is deliberately limited to what was actually found.

  # BL-937 stock-bash-32-portability-02
  Scenario Outline: no tracked shell script reaches for a construct stock bash 3.2 lacks
    Given the repo's tracked shell scripts with comment lines excluded
    When they are scanned for <construct>
    Then no occurrence is found

    Examples:
      | construct                           |
      | mapfile or readarray                |
      | case-converting parameter expansion |
