Feature: BL-1250 the expeditor observes one role agent per role, whatever processes a role runs

  The probe counts every process whose argv contains the launch directory, and
  a launched role contributes two of them - the zsh launcher script and the
  claude agent it starts. The expected live set says eight, so a completely
  healthy eight-role pack is observed as sixteen and the restart is reported
  as degraded. Measured on 2026-08-28 against a pack that was whole: one tmux
  server answering with eight sessions, handoffd and its supervisor up, and a
  report reading "role-agents expected 8, observed 16". The verdict that
  exists to catch a real half-launch is falsified on every healthy run.

  # IR-DRY: two findings reviewed and deliberately not extracted. "delta is
  # empty" versus "delta is not empty" is the deliberate polarity that proves
  # the fix is not vacuous, and "running both its launcher and its agent"
  # versus "running its launcher" is scenario 02's whole point - the agents
  # are the processes that are missing. Neither is accidental drift.

  Background:
    Given a recorded process table for a project root

  # BL-1250 expeditor-role-agent-probe-counts-roles-01
  Scenario: a whole pack is observed as whole
    Given every role in the pack is running both its launcher and its agent
    When the expeditor probes the live set
    Then the observed role-agent count equals the number of roles in the pack
    And the live-set delta is empty

  # BL-1250 expeditor-role-agent-probe-counts-roles-02
  Scenario: a role whose agent has died is not counted as present
    Given every role in the pack is running its launcher
    And two of the roles have no agent running
    When the expeditor probes the live set
    Then the observed role-agent count is short by the two missing roles
    And the live-set delta is not empty

  # BL-1250 expeditor-role-agent-probe-counts-roles-03
  Scenario Outline: the count follows the number of roles, not the number of processes
    Given a pack of <roles> roles each running <processes> processes of its own
    When the expeditor probes the live set
    Then the observed role-agent count equals the number of roles in the pack

    Examples:
      | roles | processes |
      | 8     | 2         |
      | 8     | 3         |
      | 2     | 2         |
      | 1     | 1         |

  # BL-1250 expeditor-role-agent-probe-counts-roles-04
  Scenario: role processes belonging to another project root are not counted
    Given every role in the pack is running both its launcher and its agent
    And a role process belonging to a different project root is also running
    When the expeditor probes the live set
    Then the observed role-agent count equals the number of roles in the pack
