Feature: Every briefing send commits its sent marker
  The briefing-email sweep records each send in docs/briefings/.sent.json
  and commits it (BL-821), so a fresh checkout or a second host never mails
  the same briefing twice and other tools can read when a briefing went
  out. From 2026-10-02 to 2026-10-07 every logged commit failed: three times
  because the daemon's project root was relative and `git add`, run inside
  docs/briefings, looked for docs/briefings/docs/briefings/.sent.json; twice
  because another commit held the index lock. The markers for 10-03 to 10-06
  reached git only through a hand commit on 10-06, and 10-07's had not.

  Background:
    Given a fixture repository with a briefings directory whose sent marker is committed

  # BL-2069 every-briefing-send-commits-its-sent-marker-01
  Scenario Outline: a send's marker is committed whichever way the daemon's root was given
    Given the briefing sweep's project root is given as <form> path
    When the briefing sweep records a briefing as sent
    Then HEAD's sent marker lists that briefing

    Examples:
      | form        |
      | an absolute |
      | a relative  |

  # BL-2069 every-briefing-send-commits-its-sent-marker-02
  Scenario: an index lock held for a moment delays the commit, it does not lose it
    Given another git process holds the fixture's index lock for 2 seconds
    When the briefing sweep records a briefing as sent
    Then HEAD's sent marker lists that briefing

  # BL-2069 every-briefing-send-commits-its-sent-marker-03
  Scenario: a marker an earlier failure left uncommitted is committed by the next sweep
    Given the working tree's sent marker lists a briefing that HEAD's does not
    When the briefing sweep runs with nothing new to send
    Then HEAD's sent marker lists that briefing
    And the commit changes no path but the sent marker
