Feature: BL-1602 Acceptance drivers that send a git_handoff answer the self-audit challenge

  BL-1529 made the first valid swarm_handoff.bb invocation of a
  git_handoff draft print AUDIT_REQUIRED and exit non-zero; a sender
  queues by re-invoking with the identical draft. Script senders, shell
  tests and bb runners were swept; the acceptance drivers under
  specs/pipeline/steps were not, and ten shipped features have been red
  since 2026-09-12 with nobody recording it. This feature is that a shared
  helper speaks the two-call protocol and nothing else, that the population
  of git_handoff-drafting drivers is pinned by name so a driver the scan
  misses cannot pass by absence, and that the evidence records each red
  feature's failing-step count and its green run.

  # BL-1602 acceptance-drivers-answer-the-self-audit-01
  Scenario Outline: the helper returns only a real queue or a real refusal, calling the sender at most twice with the identical draft
    Given a sender thunk whose first call <first>
    When the two-call helper sends one git_handoff draft through it
    Then the thunk was called exactly <calls> times with the same draft
    And the helper returns <returned>

    Examples:
      | first                                              | calls | returned                                  |
      | answers AUDIT_REQUIRED and queues nothing          | 2     | the second call's result                  |
      | queues the draft                                   | 1     | the first call's result, queued           |
      | refuses for a reason other than the audit          | 1     | the first call's result, refused          |

  # BL-1602 acceptance-drivers-answer-the-self-audit-02
  Scenario Outline: the population of git_handoff-drafting acceptance drivers is pinned, and every member answers the audit
    When the drivers under "specs/pipeline/steps" that draft a git_handoff and invoke swarm_handoff.bb are derived
    Then the derived set contains "<driver>"
    And "<driver>" sends through the two-call helper or answers AUDIT_REQUIRED itself

    Examples:
      | driver                                                              |
      | specs/pipeline/steps/bl1001DifficultyAwareSeatRoutingSteps.js       |
      | specs/pipeline/steps/bl1004ReworkClaimSteps.js                      |
      | specs/pipeline/steps/bl1167SameModelSeatRoutingSteps.js             |
      | specs/pipeline/steps/bl1185WorkNoteMissingTaskHeaderSteps.js        |
      | specs/pipeline/steps/bl1317AdaptEffortSteps.js                      |
      | specs/pipeline/steps/bl606RequiredStagesRoutingSteps.js             |
      | specs/pipeline/steps/bl623RoutingSkipTrailSteps.js                  |
      | specs/pipeline/steps/bl983StageQueueSteps.js                        |
      | specs/pipeline/steps/corruptHandoffNeverDispatchedSteps.js          |
      | specs/pipeline/steps/lib/bl1192TaskScopeGateCli.sh                  |
      | specs/pipeline/steps/lib/bl1276AcceptanceExemptionCli.sh            |

  # BL-1602 acceptance-drivers-answer-the-self-audit-03
  Scenario: the evidence records each formerly red feature with its failing-step count and its green run
    When the parcel's evidence for the sweep is read
    Then it lists exactly 10 features with a pre-fix failing-step count and a post-fix green run each
