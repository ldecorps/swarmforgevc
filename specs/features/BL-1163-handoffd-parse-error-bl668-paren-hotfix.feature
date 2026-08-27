Feature: handoffd parse error from BL-668 post-QA sweep paren hotfix

  # BL-668's post-QA branch-sweep helpers under-closed two defn bodies, so
  # Babashka cannot load handoffd.bb. This slice restores parse and daemon
  # start — the swarm-down class that blocked every delivery until repaired.

  Background:
    Given a throwaway project root with a fake tmux socket and roles.tsv
    And handoffd.bb is invoked from that fixture root

  # BL-1163 handoffd-loads-without-parse-error-01
  Scenario: handoffd.bb loads under Babashka without a parse failure
    When handoffd.bb is loaded by Babashka from the fixture root
    Then the load completes without an EOF while reading or unmatched delimiter error

  # BL-1163 one-shot-flags-reachable-02
  Scenario Outline: one-shot handoffd flags still reach their done log lines after the paren repair
    When handoffd.bb is invoked with "<flag>"
    Then the daemon log contains "<done_line>"
    And handoffd exits without a load-time syntax failure

    Examples:
      | flag               | done_line              |
      | --poll-once        | poll-once done         |
      | --sweep-once       | sweep-once done        |
      | --chase-sweep-once | chase-sweep-once done  |

  # BL-1163 wiring-test-green-03
  Scenario: the BL-728 handoffd one-shot parse wiring test is green
    When test_handoffd_one_shot_flags_parse.sh runs against the parcel commit
    Then every check in that script reports PASS
