Feature: pilot-gate test stubs satisfy every required member of the deps contract

  # BL-1221 (epic code-quality-gates). Surfaced by QA on 2026-08-28 (note
  # 001816, priority 00) while clearing BL-1189. BL-757 (2ed133333) added
  # `checkOrphanedAuthoredDocs` as a REQUIRED member of landPilotedTicket's
  # deps contract (pilotAcceptanceGate.ts:246) with an unconditional call at
  # line 609, and wired production correctly (pilot-acceptance-gate.ts:197).
  # The 16 test files that call landPilotedTicket were never updated: the name
  # appears nowhere under extension/test/, so each throws
  # "deps.checkOrphanedAuthoredDocs is not a function" before reaching its
  # own assertions.
  #
  # No compile step can catch this — the contract is a TypeScript interface and
  # the stubs are object literals in plain .js files, so the two are never
  # compared. Closing that gap structurally is deliberately out of scope here.
  #
  # Ten of the 16 also carry BL-1220's node:test defect and currently never
  # collect at all, so their copy of this failure is masked until that ticket
  # lands. Both tickets are independently landable.

  Background:
    Given a test that drives landPilotedTicket through a deps stub

  # BL-1221 stub-supplies-required-member-01
  Scenario: The deps stub supplies the required orphan-docs check
    When the test builds its deps stub
    Then the stub supplies "checkOrphanedAuthoredDocs"

  # BL-1221 land-reaches-its-assertions-02
  Scenario: Landing runs to its own assertions instead of throwing on a missing dep
    When the test lands a piloted ticket through that stub
    Then the land completes without reporting a missing deps member
    And the test's own assertions decide its verdict

  # BL-1221 contract-stays-required-03
  Scenario: The production contract is not weakened to accommodate the stubs
    When the deps contract is inspected
    Then "checkOrphanedAuthoredDocs" is still a required member
    And the land path calls it without guarding on its presence
