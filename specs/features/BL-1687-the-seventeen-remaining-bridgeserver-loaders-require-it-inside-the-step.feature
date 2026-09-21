Feature: BL-1687 The seventeen remaining bridgeServer loaders require it inside the step
  Seventeen step handlers load extension/out/bridge/bridgeServer, the
  whole bridge graph, the moment they are required - through a
  path.join-built path or a require inside a module-scope object, shapes
  no text grep for the module path can see. This feature is that none of
  them loads the graph when required alone, and that the census is the
  loader itself over every handler that mentions the module.

  # BL-1687 no-handler-loads-the-bridge-graph-when-required-alone-01
  # Census pin (BL-1445): the seventeen are named, not derived; the guard's sequential census
  # charges the shared graph to the alphabetically first eager loader, so they move together.
  Scenario Outline: requiring the handler alone never loads the bridge graph
    When <handler> is required alone in a fresh child process with the loader intercept
    Then extension/out/bridge/bridgeServer is not loaded by that require
    And the cost is under the per-handler budget

    Examples:
      | handler                                            |
      | bl1634RejectedManifestOffersNoPageFromItSteps.js   |
      | bl551LlmCostLedgerSteps.js                         |
      | bl565CostLedgerSyntheticPricingSteps.js            |
      | bl709BubbleItsOwnTelegramTopicSteps.js             |
      | bl788BubblePairingClientLogsAdoptSteps.js          |
      | bl829BubbleRemotePagePagerSteps.js                 |
      | bl851SideloadApkPreauthSteps.js                    |
      | bl866CompanionManifestPackageCatalogSteps.js       |
      | burnRateSteps.js                                   |
      | deviceRegistrySteps.js                             |
      | gateAnswerSteps.js                                 |
      | gatesListSteps.js                                  |
      | noInboundMessageIsEverLostSteps.js                 |
      | operatorProactiveNotifySteps.js                    |
      | replyRelayAtLeastOnceSteps.js                      |
      | standingOperatorTopicSteps.js                      |
      | telegramTopicThreadsSteps.js                       |

  # BL-1687 the-loader-census-over-every-mention-is-empty-02
  # The floor (fifty; 53 at mint) proves the census reached the directory; the population itself
  # is whatever the loader loads, so a require shape nobody has written yet cannot hide.
  Scenario: no handler that mentions bridgeServer loads it when required alone
    When every handler under specs/pipeline/steps whose source mentions bridgeServer is required alone in a fresh child process with the loader intercept
    Then none of them loads extension/out/bridge/bridgeServer
    And at least fifty handlers were examined
