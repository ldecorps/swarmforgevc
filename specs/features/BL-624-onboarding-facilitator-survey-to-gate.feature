Feature: Onboarding facilitator slice 2 - survey to agreed contract through the existing gate

  # BL-624 (BL-590 slice 2). The do-for-you phase: the facilitator clones
  # the target GitHub repo with THIS box's own GitHub access and drives the
  # shipped onboarding CLIs against its own clone - survey
  # (contractSurvey), propose (propose-onboarding-contract.js), negotiate
  # (negotiate-onboarding-contract.js runObject/runApprove - the ONE
  # writer of negotiation state, BL-381), and the EXISTING fail-closed
  # onboarding-contract-gate.js. No CLI is reimplemented; the facilitator
  # chains them and narrates. The agreed contract is committed back to the
  # target repo on GitHub. Epic swarm-intelligence-layer.

  Background:
    Given a facilitator with a target onboarding in state "prerequisites-ready"

  # BL-624 survey-runs-on-own-clone-01
  Scenario: the survey phase clones the target repo and posts the proposed contract
    When the principal posts the proceed control
    Then the facilitator clones the target repo using its own GitHub access
    And the survey runs against the facilitator's clone
    And the proposed contract is posted into the Onboarding topic
    And the state advances to "contract-proposed"

  # BL-624 show-me-inspection-02
  Scenario: the show-me control posts the current contract without changing state
    Given the onboarding is in state "contract-proposed"
    When the principal posts the show-me control
    Then the current proposed contract is posted into the topic
    And the state stays "contract-proposed"

  # BL-624 change-this-runs-a-real-object-round-03
  Scenario: the change-this control runs a real negotiation object round
    Given the onboarding is in state "contract-proposed"
    When the principal posts the change-this control with an objection
    Then the objection is applied via the existing negotiate object round
    And a revised contract is posted into the topic
    And the state is "negotiating"

  # BL-624 proceed-agrees-via-existing-approve-04
  Scenario: the proceed control agrees the contract via the existing approve round
    Given the onboarding is in state "negotiating" with a revised contract posted
    When the principal posts the proceed control
    Then the agreement is recorded via the existing negotiate approve round
    And the state advances to "contract-agreed"

  # BL-624 gate-is-the-existing-gate-05
  Scenario: the contract-agreed transition is proven by the existing fail-closed gate
    Given the onboarding is in state "contract-agreed"
    When the facilitator checks the build-start gate
    Then the check shells to the existing onboarding contract gate
    And a failing gate keeps the onboarding blocked with the gate's own reason posted

  # BL-624 agreed-contract-committed-back-06
  Scenario: the agreed contract is committed back to the target repo on GitHub
    Given the onboarding is in state "contract-agreed"
    Then the agreed contract files are committed to the target repo
    And the commit is pushed to the target repo on GitHub
    And the facilitator posts the commit reference into the topic

  # BL-624 clone-failure-is-a-visible-hold-07
  Scenario: a failed clone or survey holds the onboarding with a visible reason
    When the principal posts the proceed control and the clone fails
    Then the state stays "prerequisites-ready"
    And the facilitator posts the failure reason and the retry instruction
