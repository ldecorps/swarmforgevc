Feature: BL-1458 Every briefing trigger instructs the documenter and the host's compose nudge is retired

  The human ruled on 2026-09-07 (answer A to the specifier's question) that
  the morning briefing has one author, the documenter, as BL-658's closing
  ceremony already assumes. Two older triggers still ask the coordinator to
  compose it: the VS Code host's once-a-day briefing-due nudge (BL-099) and
  the daemon's fixed-morning fallback (BL-258), both injecting "Daily
  briefing due: compose today's briefing per your role" into the coordinator
  pane. With two authors the briefing was composed twice on 2026-09-05 and
  2026-09-07. After this parcel every trigger that asks an agent for the
  briefing sends the documenter the ceremony's own instruction note, the
  host asks nobody, and the banked headless composer (BL-308) stays the only
  non-documenter writer, only while hibernated.

  Background:
    Given a fixture root with a daemon-shaped .swarmforge and no tmux server

  # BL-1458 the-fallback-trigger-instructs-the-documenter-01
  Scenario: the fixed-morning fallback queues the briefing instruction for the documenter and injects nothing
    Given the closure schedule is unusable and today's briefing does not exist
    And the configured morning time has passed
    When the briefing generation sweep runs
    Then a note reading "produce the morning briefing for <today>" is queued for the documenter
    And no pane instruction is injected into any role

  # BL-1458 a-day-whose-briefing-exists-gets-no-instruction-02
  Scenario: a day whose briefing already exists gets no instruction
    Given today's briefing already exists under docs/briefings
    And the configured morning time has passed
    When the briefing generation sweep runs
    Then no note is queued for any role

  # BL-1458 the-host-asks-nobody-to-compose-03
  Scenario: the VS Code host no longer asks any role to compose the briefing
    When extension/src and swarmforge/scripts are inspected
    Then no source line contains the text "compose today's briefing per your role"
    And the host's briefing-due path still emits the cost and health sidecar

  # BL-1458 one-instruction-literal-across-the-language-boundary-04
  Scenario: the ceremony's instruction and the fallback's instruction are one literal
    Given a date
    When the TypeScript instruction builder and the Babashka instruction builder are both asked for that date
    Then they produce byte-identical text

  # BL-1458 banked-mode-still-composes-headlessly-05
  Scenario: banked mode still composes headlessly and instructs nobody
    Given the swarm is hibernated and today's briefing does not exist
    And the configured morning time has passed
    When the briefing generation sweep runs
    Then the headless composer writes today's briefing
    And no note is queued for any role
