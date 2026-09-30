Feature: BL-1836 The closing ceremony waits for the documenter's briefing and never writes one itself

  Since BL-1641 (2026-09-21) a ceremony that reached its hard deadline
  with no briefing on main composed the banked "headless" briefing and
  committed it. The documenter, instructed to write that day's briefing,
  then found one on main and stopped, so from 2026-09-23 every morning
  email was that dump. The human ruled on 2026-09-30: "Il faut attendre
  que le documentaliste est fini avant de fermer le shift", and for a
  documenter still not finished when the swarm must be down, chose to stop
  without a dump and let the documenter write the briefing after the
  restart. The ceremony also missed its own early end: it read the
  email ledger as a bare list, while the sweep writes {"sent": [...]}. The
  ceremony now lands the documenter's briefing the moment it exists, ends
  when the day is recorded as sent in the ledger's own shape, and at the
  deadline stops without writing anything.

  Background:
    Given a git fixture root under a temporary directory with a main branch and a documenter branch
    And the ceremony is in its briefing phase with the documenter instructed and today's briefing not recorded as sent

  # BL-1836 the-documenters-briefing-lands-the-moment-it-exists-01
  Scenario Outline: the documenter's briefing commit is landed on main byte-identical, deadline or not
    Given the hard deadline <deadline>
    And main has no briefing for today
    And the documenter branch's newest commit adds only "docs/briefings/<today>.md"
    When the ceremony advances
    Then main's tip adds "docs/briefings/<today>.md" byte-identical to the documenter's copy and touches no other path
    And "closing-briefing-missing" is not surfaced

    Examples:
      | deadline       |
      | has not passed |
      | has passed     |

  # BL-1836 sent-in-the-ledgers-own-shape-ends-the-ceremony-02
  Scenario: a briefing recorded as sent in the email ledger's own shape ends the ceremony
    Given the hard deadline has not passed
    And main already has a briefing for today
    And docs/briefings/.sent.json records today's briefing in the shape the email sweep writes
    When the ceremony advances
    Then the recorded sequence contains "send-confirmed" before "swarm-stopped"
    And "closing-briefing-missing" is not surfaced

  # BL-1836 no-briefing-at-the-deadline-stops-without-writing-one-03
  Scenario: with no briefing anywhere at the deadline the ceremony stops without writing one
    Given the hard deadline has passed
    And main has no briefing for today
    And the documenter branch has no commit touching "docs/briefings/<today>.md"
    When the ceremony advances
    Then main's tip is unchanged
    And the recorded sequence ends with "briefing-missing, swarm-stopped"
    And "closing-briefing-missing" is surfaced

  # BL-1836 a-briefing-on-main-at-the-deadline-stops-quietly-04
  Scenario: a briefing already on main but not yet sent at the deadline stops the swarm quietly
    Given the hard deadline has passed
    And main already has a briefing for today
    When the ceremony advances
    Then main's tip is unchanged
    And "closing-briefing-missing" is not surfaced
    And the swarm is stopped
