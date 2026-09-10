Feature: BL-1518 a handoff CLI never writes outside the root its draft lives in
  swarm_handoff.bb resolves its project root and refuses a draft that lies
  outside it, so a test that drives the real CLI from a foreign cwd with an
  inherited role cannot reach a live mailbox, and the front-desk answer
  note reaches the fixture it was aimed at under any caller environment.

  Background:
    Given a fixture project A whose roles.tsv names specifier and coordinator at A's root
    And a second fixture project B with its own roles.tsv

  # BL-1518 draft-root-guard-01
  Scenario Outline: a draft outside the resolved project root is refused before any write
    Given a valid note draft under A
    When swarm_handoff.bb runs on that draft with cwd at "B" and SWARMFORGE_ROLE "<role>"
    Then it exits non-zero with one line naming the draft path and B's root
    And no file exists under B's .swarmforge that was not there before
    And A's .swarmforge/handoffs directory was never created

    Examples:
      | role        |
      | coder       |
      | coordinator |

  # BL-1518 draft-root-guard-02
  Scenario: a draft under the resolved project root queues as before
    Given a valid note draft under A
    When swarm_handoff.bb runs on that draft with cwd at "A" and SWARMFORGE_ROLE "coordinator"
    Then exactly one outbox record exists under A's .swarmforge/handoffs
    And that record carries "from: coordinator"

  # BL-1518 answer-note-stays-home-03
  Scenario: the front-desk answer note lands in its target root under a foreign caller environment
    Given the caller's environment carries SWARMFORGE_ROLE "coder" and its cwd is inside B
    When enqueueRoleAnswerNote runs against A for role "specifier" with a short answer
    Then exactly one outbox record exists under A's .swarmforge/handoffs
    And that record carries "from: coordinator"
    And that record carries "to: specifier"
    And no file exists under B's .swarmforge that was not there before
