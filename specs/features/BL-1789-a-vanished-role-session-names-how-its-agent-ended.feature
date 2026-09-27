Feature: BL-1789 A vanished role session names how its agent ended

  A role's generated launch script ends on its agent's own command, and
  the swarm's tmux server has remain-on-exit off, so when the agent ends
  for any reason the pane exits and tmux destroys the session.
  babysitterd then logs "swarmforge-<role>: tmux session missing",
  recreates the session in the same sweep (BL-1017), and escalates the
  CRIT to the operator. Nothing records how the agent ended, so every
  reader has to guess. babysitterd logged 7 pane-hardender CRITs
  between 2026-09-25 and 2026-09-27. On 2026-09-27 the coordinator told
  the human they were OOM kills, and they were not: every dmesg victim on
  this host is llama-server. The operator's correction called them clean
  agent exits, and that is unverified too. With this feature every
  launch script records its agent's start and exit, and the
  session-missing CRIT names the role's newest record. The CRIT keeps its
  existing text as a prefix, its key, its severity and its repair.

  # BL-1789 launch-records-start-and-exit-01
  Scenario Outline: the launch script records its agent's start and the status it exited with
    Given a hardender launch script from the real launch-script writer, with a stub agent that exits with status <status>
    When the hardender launch script runs to completion
    Then hardender's lifecycle record holds a start entry followed by an exit entry with status <status>
    And the launch script exited with status <status>

    Examples:
      | status |
      | 0      |
      | 137    |

  # BL-1789 unwritable-record-changes-nothing-02
  Scenario: a lifecycle record that cannot be written changes nothing about the launch
    Given a hardender launch script from the real launch-script writer, with a stub agent that exits with status 0
    And hardender's lifecycle record location cannot be created
    When the hardender launch script runs to completion
    Then the stub agent received the same first message as it does when the record is writable
    And the launch script exited with status 0

  # BL-1789 missing-session-names-the-recorded-exit-03
  Scenario Outline: a missing session whose agent recorded an exit names that exit
    Given hardender's newest lifecycle entry is an exit with status <status> recorded at 2026-09-27T07:00:58Z
    When babysitterd sweeps with hardender's tmux session missing
    Then the pane-hardender CRIT reads "swarmforge-hardender: tmux session missing" followed by exit status <status> and 2026-09-27T07:00:58Z
    And the pane-hardender finding still carries its session repair

    Examples:
      | status |
      | 0      |
      | 137    |

  # BL-1789 missing-session-with-a-start-and-no-exit-04
  Scenario: a missing session whose agent recorded a start and no exit says the agent recorded no exit
    Given hardender's newest lifecycle entry is a start recorded at 2026-09-27T06:00:31Z
    When babysitterd sweeps with hardender's tmux session missing
    Then the pane-hardender CRIT reads "swarmforge-hardender: tmux session missing" followed by 2026-09-27T06:00:31Z and that no exit was recorded after it
    And the CRIT names no exit status

  # BL-1789 missing-session-without-a-readable-entry-05
  Scenario Outline: a missing session whose lifecycle record is <record> says no entry was readable and names no cause
    Given hardender's lifecycle record is <record>
    When babysitterd sweeps with hardender's tmux session missing
    Then the pane-hardender CRIT reads "swarmforge-hardender: tmux session missing" followed by that no lifecycle entry was readable for hardender
    And the CRIT names no exit status

    Examples:
      | record         |
      | absent         |
      | not valid JSON |
