# mutation-stamp: sha256=84d8f0ee9ab5667d4815dcbe8dc0fae1f0d4b2d15b74fdd2e049cf771d2737dd
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-08T19:42:50.691270311Z","feature_name":"Every briefing send commits its sent marker","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-2069-every-briefing-send-commits-its-sent-marker.feature","background_hash":"4042f403800a79bc2b1551f7891f936762f0838bd21bdf1306e8d3f4efb9e0a3","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a send's marker is committed whichever way the daemon's root was given","scenario_hash":"52ce4efdc2015564a2c22c498a9aaed0a42931001c97475751f14bd3a1caffa6","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-10-08T10:40:45.532204968Z"}]}
# acceptance-mutation-manifest-end

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
