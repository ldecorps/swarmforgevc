Feature: BL-1658 The seven remaining eager jsdom handlers, and the one eager cursor-bridge handler, require their heavy module inside the step that needs it

  BL-1630 moved two handlers' module-level jsdom require inside their
  functions and found that a sequential require census charges jsdom's
  whole load to whichever eager handler is alphabetically first: fixing
  one only unmasks the next, seven deep - bl592, bl609, bl674, bl686,
  bl687, bl775, bl929. BL-1630 allowlisted bl592 with this ticket as the
  owner. bl1050CursorRunFailureLogSteps.js does the same with the
  cursor-bridge session graph (174-204 ms alone, over the 400 ms budget
  under the full unit suite - a unit red on main first sighted
  2026-09-21, owned by this ticket). After this parcel all eight require
  their heavy module inside the step that needs it, every one of their
  scenarios still resolves, and the guard's allowlist carries no jsdom
  entry and no bl1050 entry.

  # BL-1658 the-eight-load-their-heavy-module-lazily-01
  # Census pin (BL-1445): the eight are named, not derived; the grep that found the seven is in the ticket, bl1050 is the 2026-09-21 sighting.
  Scenario Outline: a named handler required alone in a fresh child loads neither jsdom nor the cursor-bridge session module and costs under the budget
    When <handler> is required alone in a fresh child process with the loader intercept
    Then neither a jsdom module nor extension/out/bridge/cursorBridgeAgentSession is loaded by that require
    And the cost is under the per-handler budget

    Examples:
      | handler                                        |
      | bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js |
      | bl609ResidentSpyFontSizeControlSteps.js        |
      | bl674EpicDrilldownUiSteps.js                   |
      | bl686EpicDrilldownSlugMatchSteps.js            |
      | bl687EpicReorderIncludesActiveChildrenSteps.js |
      | bl775BubbleLiveScreenShellSteps.js             |
      | bl929LiveScreenPackLayoutSteps.js              |
      | bl1050CursorRunFailureLogSteps.js              |

  # BL-1658 the-allowlist-carries-no-jsdom-entry-02
  Scenario: the module-load budget guard over the real tree names none of the eight with an empty allowlist
    When the module-load budget guard runs the require census over every step handler with an empty allowlist
    Then it names none of the eight as a violation
