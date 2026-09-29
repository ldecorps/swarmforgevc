Feature: BL-1812 APS candidate equivalence run at the step-data-table tip
  BL-959's dual-run harness compared our pinned APS toolchain (accaa33d)
  with codex/bb-tools-equivalence at 1001283af, and names that one commit
  in a constant. The branch tip is now 27e9915678. It adds 5758904: the
  parser keeps step data tables in the IR, orphan and mismatched rows
  become parse errors, and the mutator mutates table cells like example
  values. This run measures that tip against the pin over today's corpus.
  It reports only: the pin bump and the re-vendor stay human commits.

  # BL-1812 run-only-at-the-requested-commit-01
  Scenario Outline: the equivalence run checks the candidate checkout against the requested commit before running anything
    Given a candidate checkout whose HEAD <relation> the requested candidate commit
    When the equivalence run is started with that checkout and that requested commit
    Then the run <outcome>

    Examples:
      | relation     | outcome                                                        |
      | equals       | passes the commit check                                        |
      | differs from | refuses before running either toolchain and names both commits |

  # BL-1812 step-table-features-in-the-site-corpus-02
  Scenario: mutation-site enumeration covers every live feature that carries a step data table
    When the equivalence run's mutation-site corpus is built from specs/features
    Then it contains every live feature with a data table under a step
    And that set includes "specs/features/BL-244-swarm-is-a-composite-node.feature"
