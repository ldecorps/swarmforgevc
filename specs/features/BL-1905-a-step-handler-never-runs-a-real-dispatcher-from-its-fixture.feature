Feature: BL-1905 An acceptance step handler never runs a real receive or completion dispatcher from its fixture

  BL-998 made the shell tests install the scripts tree into their fixture,
  because a receive or completion dispatcher that cds into its own scripts
  dir runs in the checkout that holds that dir, not in the fixture. The
  acceptance step handlers under specs/pipeline/steps were never covered.
  On 2026-10-02 bl1317AdaptEffortSteps.js ran the real
  done_with_current_task.bb from its fixture; that helper ends by exec'ing
  the real ready_for_next_task.sh, so the receive ran as the coder in the
  checkout QA was running the feature from, read the live coder's mailbox,
  and moved QA's branch (BL-1904 stops the move; the stray receive is this
  ticket's). Four more handlers had the same shape at mint, and
  bl615OrphanedClaimProgressSidecarReapSteps.js set
  SWARMFORGE_SKIP_READY_FOR_NEXT, which no script reads. Hotfix 224074e2a7
  moved complianceBatterySteps.js onto its fixture's own scripts copy.

  Background:
    Given the receive and completion dispatchers that cd into their own scripts dir

  # BL-1905 no-handler-executes-a-real-dispatcher-01
  Scenario: no step handler executes a real receive or completion dispatcher
    When every step handler under specs/pipeline/steps is scanned for a real-scripts-dir path to one of those dispatchers
    Then no handler passes such a path to a process it starts

  # BL-1905 the-scan-sees-the-real-path-idiom-02
  Scenario: the scan's candidate set holds the handlers that name a real dispatcher without starting it
    When every step handler under specs/pipeline/steps is scanned for a real-scripts-dir path to one of those dispatchers
    Then the candidates include bl1611DriftGuardSeesBatchParcelSteps.js, bl1642QaApprovalCompletesOnNoteEvidenceSteps.js, bl1645EvidenceWindowOpensAtCreationSteps.js and complianceBatterySteps.js
    And none of those four is flagged

  # BL-1905 the-bl1317-shape-is-flagged-03
  Scenario: a handler that starts the real completion helper from its fixture is flagged by name
    Given a synthetic step handler that spawns the real done_with_current_task.bb with its fixture as cwd
    When that handler is scanned
    Then it is flagged and named
