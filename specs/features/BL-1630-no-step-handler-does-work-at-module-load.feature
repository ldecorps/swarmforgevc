Feature: BL-1630 No step handler does work at module load

  Registration is discovery: index.js requires every step handler at load,
  and every acceptance run, every QA-bound send and bl968's two spawns pay
  that load - 12.6 seconds of require time across 1189 handlers on
  2026-09-17. Twelve handlers carry ten and a half of those seconds: six
  list the shared temp dir at module load, three require node:test at
  load, two require jsdom at load. This feature is that the twelve do that
  work inside their step functions instead, that a unit-lane guard pins
  every handler's incremental require cost and the whole load under a
  budget, and that the before-and-after census is recorded with one
  re-runnable script.

  # BL-1630 no-step-handler-works-at-module-load-01
  # Census pin (BL-1445): the twelve are named, not derived.
  Scenario Outline: a named handler requires under the budget and does no work at load
    When <handler> is required in a fresh child process and its incremental cost is measured
    Then the cost is under the per-handler budget
    And requiring it lists no directory, spawns no process and registers no test runner

    Examples:
      | handler                                         |
      | bl1299ReverseHopMasterResidentSteps.js          |
      | bl1327DescentLadderProposalSteps.js             |
      | bl1320SeatOperatorStepSteps.js                  |
      | bl1306HandoffAuditRerouteSteps.js               |
      | bl1323MainSyncDeadlockOverlapHintsStampSteps.js |
      | bl1332SharedPathLineLeakSteps.js                |
      | bl1153StickyWebFontSizeChoiceSteps.js           |
      | bl1335ExhaustionOpensFailoverRecordSteps.js     |
      | bl1339LandApprovalSharedRootSteps.js            |
      | bl1375ApprovedSiblingsCanLandSteps.js           |
      | bl1352EscalationTransportFaultSteps.js          |
      | bl1343ReplayDropsTheTicketsOwnPathSteps.js      |

  # BL-1630 no-step-handler-works-at-module-load-02
  Scenario: the guard over the real tree passes and names an offender when one exists
    When the module-load budget guard runs the require census over every step handler
    Then it reports every handler under the per-handler budget, or on its allowlist with an owning ticket, and the index load under 5 seconds
    And the same guard over a fixture handler that lists the temp dir at load names that handler

  # BL-1630 no-step-handler-works-at-module-load-03
  Scenario: the census is recorded before and after with one script
    When the parcel's evidence is read
    Then it carries the census script's output for the received commit and for the parcel commit
    And both name the twelve handlers and the two totals
