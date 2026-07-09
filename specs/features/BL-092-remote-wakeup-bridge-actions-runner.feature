Feature: the remote swarm wakes on relevant pushes without open ports

Background:
  Given the second swarm runs under WSL2 with a registered self-hosted
    runner (BL-091 merged)

# BL-092 wakeup-bridge-01
Scenario: assignment push wakes the remote specifier
  Given the primary coordinator pushes a promotion assigning a ticket to
    the second swarm
  When the workflow run for that push completes
  Then the remote checkout contains the assignment commit
  And the remote specifier pane received a wake-up nudge

# BL-092 wakeup-bridge-02
Scenario: other-swarm pushes do not nudge
  Given a push whose backlog changes concern only the primary swarm
  When the workflow evaluates the push
  Then no wake-up is delivered to the remote specifier

# BL-092 wakeup-bridge-03
Scenario: duplicate nudges are harmless
  Given the remote specifier already processed the latest assignment
  When a duplicate or repeated nudge arrives
  Then ready_for_next.sh reports no new work and nothing is disturbed

# BL-092 wakeup-bridge-04
Scenario: bridge outage degrades to the poll fallback
  Given GitHub Actions is unavailable
  When new work is assigned to the second swarm
  Then the fallback periodic pull picks it up within its timer interval

# Non-behavioral gates:
#  - The nudge/no-nudge decision is a pure, unit-tested function fed with
#    changed paths / ticket fields (no live GitHub in tests).
#  - Workflow YAML contains no repo secrets and no business logic beyond
#    sync + nudge.
