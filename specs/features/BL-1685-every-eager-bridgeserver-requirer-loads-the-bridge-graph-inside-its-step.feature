Feature: BL-1685 Every eager bridgeServer requirer loads the bridge graph inside its step
  Fourteen step handlers require extension/out/bridge/bridgeServer at
  module scope, and that module is the whole bridge graph: 286 modules,
  most of a second alone. The module-load budget guard charges a shared
  graph to the alphabetically first eager requirer, so the red walks from
  handler to handler until every one is lazy. This feature is that none
  of the fourteen loads the bridge graph when required alone, and that
  the census of eager requirers is pinned and empty.

  # BL-1685 no-handler-loads-the-bridge-graph-when-required-alone-01
  # Census pin (BL-1445): the fourteen are named, not derived; a sequential census charges the
  # shared graph to the alphabetically first eager requirer, so fixing them one at a time
  # re-arms the guard on the next name.
  Scenario Outline: requiring the handler alone never loads the bridge graph
    When <handler> is required alone in a fresh child process with the loader intercept
    Then extension/out/bridge/bridgeServer is not loaded by that require
    And the cost is under the per-handler budget

    Examples:
      | handler                                            |
      | bl1412SpecTreeTextFilterSteps.js                   |
      | bl538ConsolePausedTicketPagerSteps.js              |
      | bl572EpicReorderConsoleSteps.js                    |
      | bl591EpicEtaSteps.js                               |
      | bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js     |
      | bl665ContextTelemetryProducerWiringSteps.js        |
      | bl672EpicMakeTopPrioritySteps.js                   |
      | bl673TopicMakeTopPrioritySteps.js                  |
      | bl674EpicDrilldownUiSteps.js                       |
      | bl686EpicDrilldownSlugMatchSteps.js                |
      | bl687EpicReorderIncludesActiveChildrenSteps.js     |
      | bl766MiniAppLetsTalkRetiredSteps.js                |
      | bl905HideChildlessEpicsReorderSteps.js             |
      | gh23ContextBudgetDashboardSteps.js                 |

  # BL-1685 the-census-of-eager-requirers-is-empty-02
  # The total is a FLOOR (32 at mint, 33 on main by 16:40Z as BL-1658's own handler landed): the steps
  # directory grows with every ticket whose handler mentions the path in step text, so the pin that
  # matters is the named eager set in scenario 01 being empty after the parcel; the floor only proves
  # the scan reached the directory (amendment 2026-09-21, coder note 000053).
  Scenario: the census of handlers requiring bridgeServer at module scope is empty
    When the byte-safe census greps specs/pipeline/steps for bridge/bridgeServer
    Then it names at least thirty-two handlers
    And none of them requires bridge/bridgeServer at module scope
