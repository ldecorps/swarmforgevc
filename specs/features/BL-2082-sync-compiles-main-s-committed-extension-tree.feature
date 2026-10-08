Feature: sync compiles main's committed extension tree
  build_freshness_cli.bb's sync recompiles the extension before it restarts
  a stale daemon group. Its recompile ran npm run compile inside the master
  checkout's extension/, so it compiled whatever the working tree held. sync
  refuses an uncommitted change under the deployed surface, but its override
  compiled the change anyway and the build was stamped with main's commit:
  from 2026-07-27 to 2026-10-07, 170 of 258 logged overrides ran with such a
  change present, and the one at 2026-10-07T10:23:40Z listed the stray,
  uncommitted repo reader whose secret filter leaked. Since BL-2065 the
  front desk's own recompile builds main's committed tree; sync now builds
  it the same way.

  Background:
    Given a fixture swarm whose main commits an extension that compiles
    And one of the fixture's daemons runs a build older than main

  # BL-2082 overridden-sync-compiles-main-01
  Scenario Outline: an overridden sync compiles main's committed tree, not the working tree
    Given the fixture's master working tree holds <change>
    When sync runs with the override
    Then the compiled output holds main's committed code and not the change
    And the compiled output's BUILD_SHA names main's commit
    And the fixture's master working tree is unchanged by the sync

    Examples:
      | change                                       |
      | an uncommitted edit to a tracked source file |
      | an untracked source file                     |

  # BL-2082 failed-main-build-restarts-nothing-02
  Scenario: a sync whose main build fails restarts nothing
    Given main's committed extension in the fixture does not compile
    When sync runs with the override
    Then the sync exits non-zero naming the compile failure
    And no daemon group of the fixture is restarted
