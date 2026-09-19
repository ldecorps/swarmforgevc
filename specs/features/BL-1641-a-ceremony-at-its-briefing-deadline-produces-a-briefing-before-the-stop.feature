Feature: BL-1641 A closing ceremony at its briefing deadline produces a briefing before the stop

  The ceremony's briefing phase waits for the day's briefing until the hard
  deadline, then surfaces closing-briefing-missing and stops the swarm. On
  2026-09-18 the documenter had committed a full briefing on its own branch
  twelve minutes after being asked; QA never landed it before bedtime, and
  the headless composer the swarm keeps for no-agent moments was never
  consulted. After this parcel a deadline with no briefing on main lands the
  documenter's own commit when one exists, otherwise composes the banked
  briefing and commits it, stays loud either way, never touches a briefing
  main already has, and still ends the night as before when nothing can be
  produced.

  Background:
    Given a git fixture root under a temporary directory with a main branch and a documenter branch
    And the ceremony is in its briefing phase with today's briefing not recorded as sent
    And the hard deadline has passed

  # BL-1641 the-documenters-own-commit-is-landed-01
  Scenario: the documenter branch's briefing commit is landed on main byte-identical
    Given main has no briefing for today
    And the documenter branch's newest commit adds only "docs/briefings/<today>.md"
    When the ceremony advances
    Then main's tip adds "docs/briefings/<today>.md" byte-identical to the documenter's copy and touches no other path
    And the recorded sequence contains "briefing-landed-from-documenter" before "swarm-stopped"
    And "closing-briefing-missing" is surfaced

  # BL-1641 the-banked-briefing-is-composed-when-nothing-was-written-02
  Scenario: with no briefing anywhere the banked briefing is composed and committed
    Given main has no briefing for today
    And the documenter branch has no commit touching "docs/briefings/<today>.md"
    When the ceremony advances
    Then main's tip adds "docs/briefings/<today>.md" whose first line is "Closing ceremony - headless briefing for <today>"
    And the recorded sequence contains "briefing-composed-headless" before "swarm-stopped"
    And "closing-briefing-missing" is surfaced

  # BL-1641 a-briefing-main-already-has-is-never-touched-03
  Scenario: a briefing main already has but has not emailed is left alone
    Given main already has a briefing for today
    When the ceremony advances
    Then main's tip is unchanged
    And the recorded sequence ends with "briefing-missing, swarm-stopped"
    And "closing-briefing-missing" is surfaced

  # BL-1641 nothing-producible-still-ends-the-night-loudly-04
  Scenario: with no documenter commit and a failing composer the night still ends as BL-658 built it
    Given main has no briefing for today
    And the documenter branch has no commit touching "docs/briefings/<today>.md"
    And the banked composer exits non-zero
    When the ceremony advances
    Then main's tip is unchanged
    And the recorded sequence ends with "briefing-missing, swarm-stopped"
    And "closing-briefing-missing" is surfaced
    And the swarm is stopped
