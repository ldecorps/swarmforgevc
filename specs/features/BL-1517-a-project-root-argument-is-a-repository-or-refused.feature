Feature: BL-1517 a project-root argument is a repository or refused
  A Babashka CLI taking <project-root> positionally checks the argument
  before binding it: blank, flag-shaped, not a directory, or not inside a
  git checkout is refused with usage and exit 2 before any write.

  # BL-1517 project-root-arg-01
  Scenario Outline: a root argument that is not a git checkout is refused before any write
    Given the current directory is a mkdtemp directory that is not a git checkout
    When "<cli>" is invoked with "<arg>" in its project-root position
    Then it exits 2
    And stderr carries a line "REFUSED project-root <arg>:" followed by a reason
    And the current directory has no new entry

    Examples:
      | cli                     | arg         |
      | main_sync_status_cli.bb | --help      |
      | operator_runtime.bb     | --tick-once |
      | operator_runtime.bb     | --check-once |
      | expedite_cli.bb         | unpark      |

  # BL-1517 project-root-arg-02
  Scenario: a valid root is accepted unchanged
    Given a fixture git checkout under mkdtemp
    When "main_sync_status_cli.bb" is invoked with that checkout as its project root
    Then it prints its JSON verdict as before
    And no REFUSED line is printed

  # BL-1517 project-root-arg-03
  Scenario: the expedite unpark subcommand checks its own root position
    Given the current directory is a mkdtemp directory that is not a git checkout
    When "expedite_cli.bb" is invoked as "unpark tmp/x run-dir"
    Then it exits 2
    And stderr carries a line "REFUSED project-root tmp/x:" followed by a reason
    And the current directory has no new entry
