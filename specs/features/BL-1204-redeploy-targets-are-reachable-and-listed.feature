Feature: every redeploy target the bridge accepts is reachable from Telegram and listed in help

  # BL-1204 (epic swarm-reliability). Read from the working tree on
  # 2026-08-27 20:05 BST, three times, stable:
  #   - extension/src/tools/telegramCursorBridgeFrontDeskRedeploy.ts exists
  #   - extension/src/tools/telegramCursorBridgeAllRedeploy.ts exists
  #   - NOTHING in extension/src imports either one (grep for the module
  #     names across extension/src returns no hit)
  #   - telegramCursorBridgeCore.ts contains neither "redeploy frontdesk"
  #     nor "redeploy all": no confirm branch, no help line. Its
  #     formatHelpMessage is the live help path, called from
  #     telegramCursorBridgeLive.ts:919, and it lists only /redeploy and
  #     /redeploy miniapp.
  #   - extension/test/telegramCursorBridgeCore.test.js still asserts both
  #     missing help lines, so the unit suite carries a standing red.
  #   - extension/test/telegramCursorBridgeRedeployTargets.test.js tests the
  #     two orphaned modules directly and therefore passes, which is why a
  #     dark feature reads green from that file alone.
  #
  # So both mechanisms are built and neither is wired: typing
  # "/redeploy frontdesk" or "/redeploy all" at the bridge reaches no
  # handler. This is the BL-419 shape — a lib shipped, unit-tested, green,
  # and wired into zero of the places it was built for.
  #
  # Deliberately NOT asserted here: how the wiring came to be absent.
  # git log -S over the core file gave contradictory readings minutes apart
  # while a fixture harness was actively rewriting refs in this repository
  # (BL-1196 / BL-1200 / BL-1202), and git gc reported "failed to run prune"
  # in the same window. History attribution is therefore unavailable and
  # must not be re-derived from this repository until that corruption is
  # closed out. Nothing in this ticket depends on the answer.

  Background:
    Given the Cursor bridge is accepting Telegram commands

  # BL-1204 redeploy-target-reaches-its-handler-01
  Scenario Outline: A built redeploy target is reachable from Telegram
    When the operator sends "/redeploy <target>"
    Then the command is accepted as a soft-confirm redeploy for <target>

    Examples:
      | target    |
      | frontdesk |
      | all       |
      | miniapp   |

  # BL-1204 help-lists-exactly-the-accepted-targets-02
  Scenario: The help message lists exactly the redeploy targets the bridge accepts
    When the operator asks for help
    Then every redeploy target the bridge accepts is listed
    And every redeploy target the help message lists is accepted
