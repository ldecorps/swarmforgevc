Feature: every tracked shell script runs on the stock macOS /bin/bash 3.2 this repo targets

  # BL-937 (swarm-reliability). engineering.prompt is explicit: "Target
  # stock macOS /bin/bash 3.2, not Homebrew bash". Six tracked shell
  # scripts break that target by using builtins and expansions bash 3.2
  # does not have, and on this host - where /bin/bash is the only bash -
  # they cannot run at all.
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
  # The three wiring tests are the sharp end: they are three handoffd
  # rotation gates that have never once executed on this host, and their
  # failure has twice been written off in evidence files as "pre-existing
  # and unrelated" (BL-795, BL-911) without ever being ticketed.
  #
  # Scenario 02 scans code, never prose: lifecycle_matrix.sh carries a
  # comment saying it deliberately avoids `declare -A`, and a scan that
  # read comments would fail on a file that is already correct. The
  # construct list is deliberately limited to what was actually found.

  # BL-937 stock-bash-32-portability-01
  Scenario Outline: each handoffd rotation wiring test runs to completion on stock bash 3.2
    Given the stock system bash reports version 3.2
    When <test script> is run under it
    Then it runs its own scenarios to completion
    And it reports every scenario passing

    Examples:
      | test script                             |
      | test_handoffd_priority_rotate_wiring.sh |
      | test_handoffd_aged_note_rotate_wiring.sh|
      | test_handoffd_starve_rotate_wiring.sh   |

  # BL-937 stock-bash-32-portability-02
  Scenario Outline: no tracked shell script reaches for a construct stock bash 3.2 lacks
    Given the repo's tracked shell scripts with comment lines excluded
    When they are scanned for <construct>
    Then no occurrence is found

    Examples:
      | construct                           |
      | mapfile or readarray                |
      | case-converting parameter expansion |

  # BL-937 stock-bash-32-portability-03
  Scenario Outline: an operator script reaches its own logic instead of dying on a construct
    Given the stock system bash reports version 3.2
    When <script> is invoked with <arguments>
    Then no unsupported-construct error is reported
    And <observable> is reached

    Examples:
      | script                 | arguments                                  | observable                            |
      | swarm_dashboard.sh     | a fixture root whose swarm has no sessions | the no-live-sessions diagnostic       |
      | reexpedite_from_wip.sh | a fixture root and a lower-case ticket id  | the ticket id accepted in upper case  |
