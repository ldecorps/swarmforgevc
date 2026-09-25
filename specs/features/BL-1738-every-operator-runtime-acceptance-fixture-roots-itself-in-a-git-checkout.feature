Feature: BL-1738 Every operator-runtime acceptance fixture roots itself in a git checkout

  Since BL-1517 (2026-09-22), operator_runtime.bb refuses a project root
  that is not inside a git checkout. Fourteen acceptance features still
  build their fixture project roots with a bare mkdtemp, so on main 43 of
  their scenarios fail with "REFUSED project-root ...: not inside a git
  checkout" (specifier census, 2026-09-25). This feature is that one shared
  step-library helper builds such a root as a git checkout of its own,
  never touching the live repository (BL-1390), and that the handler
  behind each of those features builds its roots through it. Running the
  fourteen features themselves is too slow for this lane (BL-1541), so it
  is the ticket's QA procedure.

  # BL-1738 the-shared-root-is-an-isolated-git-checkout-01
  Scenario: the shared helper's fixture root is a git checkout of its own
    When a step handler asks the shared helper for a fixture project root
    Then the root's git common directory is inside the root itself
    And operator_runtime.bb accepts the root as a project root

  # BL-1738 each-red-handler-uses-the-shared-root-02
  Scenario Outline: the handler behind each red feature builds its roots through the shared helper
    When the step handler <handler> is read
    Then it builds its fixture project roots through the shared helper

    Examples:
      | handler                                          |
      | operatorLongtermMemorySteps.js                   |
      | operatorAutoHibernateSteps.js                    |
      | operatorSeedRaceLaunchGraceSteps.js              |
      | operatorSelfGenProvenanceSteps.js                |
      | answerPairingAcrossThreadsSteps.js               |
      | alwaysOnOperatorPresenceSteps.js                 |
      | controlLossIsNotAgentDeathSteps.js               |
      | noInboundMessageIsEverLostSteps.js               |
      | bl413StaleSandboxSweepSteps.js                   |
      | bl458AcceptanceFixtureProcessLeakSteps.js        |
      | bl460TmpSweepsBoundDeletesSteps.js               |
      | bl466AgentQuestionsAsTelegramPollsSteps.js       |
      | bl877PortableProcessLivenessSteps.js             |
      | gh26RoleQuestionUndeliverableClearsMarkerSteps.js |
