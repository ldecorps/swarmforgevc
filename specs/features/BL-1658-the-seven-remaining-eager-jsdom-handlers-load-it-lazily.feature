Feature: BL-1658 The seven remaining eager jsdom handlers require it inside the step that builds a DOM

  BL-1630 moved two handlers' module-level jsdom require inside their
  functions and found that a sequential require census charges jsdom's
  whole load to whichever eager handler is alphabetically first: fixing
  one only unmasks the next, seven deep - bl592, bl609, bl674, bl686,
  bl687, bl775, bl929. BL-1630 allowlisted bl592 with this ticket as the
  owner. After this parcel all seven require jsdom inside the step that
  builds a DOM, every one of their scenarios still resolves, and the
  guard's allowlist carries no jsdom entry.

  # BL-1658 the-seven-load-no-jsdom-01
  # Census pin (BL-1445): the seven are named, not derived; the grep that found them is in the ticket.
  Scenario Outline: a named handler required alone in a fresh child loads no jsdom and costs under the budget
    When <handler> is required alone in a fresh child process with the loader intercept
    Then no jsdom module is loaded by that require
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

  # BL-1658 the-allowlist-carries-no-jsdom-entry-02
  Scenario: the module-load budget guard over the real tree names none of the seven with an empty allowlist
    When the module-load budget guard runs the require census over every step handler with an empty allowlist
    Then it names none of the seven as a violation
