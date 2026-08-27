Feature: pilot land records durable CRAP evidence for every touched extension src file

  # BL-745: BL-718 landed six functions over CRAP<=6 with no CRAP pass evidence —
  # the second CRAP shortfall in the same BL-723 batch after BL-627/BL-741.
  # BL-741 already made scoped CRAP an always-run land gate; this slice requires
  # that pass to leave inspectable durable evidence for every touched
  # extension/src/** TypeScript file so a live review need not rediscover the
  # gap. Companion coverage fix: BL-744.

  Background:
    Given a piloted ticket whose declared acceptance contract has just passed
    And the BL-741 scoped CRAP land gate is already wired

  # BL-745 src-touch-requires-logged-crap-01
  Scenario: a ticket that touches extension src TypeScript records durable CRAP evidence at land
    Given the run's commits touched TypeScript under extension/src
    When the pilot lands the ticket
    Then the acceptance receipt records that a scoped CRAP pass ran
    And the evidence names the touched extension src paths that were scanned

  # BL-745 land-without-crap-evidence-refuses-02
  Scenario: a src-touching land without durable CRAP evidence is refused
    Given the run's commits touched TypeScript under extension/src
    And the landing path would omit CRAP evidence from the acceptance receipt
    When the pilot runs the landing gate
    Then the land is refused for missing CRAP evidence
    And the ticket yaml stays where it was

  # BL-745 evidence-inspectable-without-rerun-03
  Scenario: durable CRAP evidence is inspectable after land without re-running crapReport
    Given a ticket that touched extension/src TypeScript has landed
    When a reviewer reads the acceptance receipt
    Then the receipt shows CRAP was checked and which src paths were in scope
    And the reviewer does not need to rediscover the check from scratch

  # BL-745 non-src-touch-no-src-evidence-required-04
  Scenario: a ticket that does not touch extension src does not require src CRAP evidence
    Given the run's commits touched no TypeScript under extension/src
    When the pilot lands the ticket
    Then missing extension-src CRAP evidence does not by itself refuse the land
    And other landing gates may still refuse or complete independently

  # BL-745 refused-missing-evidence-no-durable-05
  Scenario: a refused missing-CRAP-evidence land writes nothing durable
    Given the run's commits touched TypeScript under extension/src
    And the landing path would omit CRAP evidence from the acceptance receipt
    When the pilot runs the landing gate
    Then the land is refused for missing CRAP evidence
    And no acceptance receipt is written
