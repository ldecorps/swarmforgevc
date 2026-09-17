Feature: BL-1627 Tracked shell scripts run on bash 3.2 and the guard runs on any host

  BL-937's portability feature is red on main for two reasons. Its static
  scan correctly flags mapfile, a bash 4 builtin, in two commit-guard
  scripts - real violations of the stock macOS bash 3.2 this repository
  targets. Its two runtime scenarios require the host's own /bin/bash to
  report 3.2, which no Linux host can satisfy, so on the machine the swarm
  runs on they fail without saying anything about the scripts. This
  feature is that the two scripts comply, that BL-937's static scan passes
  over every tracked script, and that the host-premise scenarios are gone
  from BL-937's feature while its scan is untouched. The macOS runtime
  check is a macOS-only e2e step, not a scenario.

  # BL-1627 tracked-shell-scripts-run-on-bash-32-01
  Scenario Outline: the two guard scripts carry no construct stock bash 3.2 lacks
    When <script> is scanned with the portability feature's construct regexes, comment lines excluded
    Then no occurrence is found

    Examples:
      | script                                                  |
      | swarmforge/scripts/check_bb_scripts_load.sh             |
      | swarmforge/scripts/check_constitution_doc_citations.sh  |

  # BL-1627 tracked-shell-scripts-run-on-bash-32-02
  Scenario: the static scan over every tracked shell script passes
    When BL-937's static construct scan runs over the repository's tracked shell scripts
    Then it reports no occurrence of any construct

  # BL-1627 tracked-shell-scripts-run-on-bash-32-03
  Scenario: the host-premise scenarios are retired and the scan scenario is intact
    When the source of BL-937's feature file is read
    Then it carries no step reading "the stock system bash reports version 3.2"
    And it still carries the static construct scan scenario
