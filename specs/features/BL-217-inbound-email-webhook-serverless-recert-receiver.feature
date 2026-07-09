Feature: a serverless inbound receiver turns recertification emails into review proposals

  Background:
    Given a serverless inbound receiver configured with the Resend signing secret

  # BL-217 webhook-01
  Scenario: a validly signed update email becomes one review proposal
    Given a phone-composed email with a scenario id, outcome "update", and new text
    And the email carries a valid Resend signature
    When the inbound receiver processes it
    Then exactly one recertification proposal is committed to the review queue
    And the proposal carries the scenario id, outcome, and new text

  # BL-217 webhook-02
  Scenario: an unsigned or forged request is rejected
    Given an inbound request whose signature does not verify
    When the inbound receiver processes it
    Then the request is rejected
    And no proposal is created

  # BL-217 webhook-03
  Scenario: a validly signed but unparseable email produces no proposal
    Given a validly signed request whose body is not a recertification email
    When the inbound receiver processes it
    Then no proposal is created
    And the failure is logged without crashing

  # BL-217 webhook-04
  Scenario: a delete write-back is queued for specifier review, not applied
    Given a phone-composed email with outcome "delete" and a valid signature
    When the inbound receiver processes it
    Then a delete proposal is committed to the review queue
    And the scenario is not removed until the specifier accepts it

  # BL-217 webhook-05
  Scenario: a committed proposal reaches the specifier's recertification review
    Given a proposal has been committed by the receiver
    When the host bridge picks up the committed proposal
    Then it enters the same durable review queue BL-150's seam feeds

# Non-behavioral gates:
#  - Reuses BL-097's serverless posture: no inbound port on the local host, no
#    tunnel. Function platform chosen at architecture review, not by coder fiat.
#  - Signing secret and repo-write credential come from function/host env only,
#    never the repo; the repo-write credential is minimally scoped and proposals
#    are never auto-applied — specifier review is the gate.
#  - Signature-verify and email-parse are pure over provided inputs (fixtures);
#    no live email, no network, no real timers in tests.
#  - Ends at a correctly-queued proposal; specifier accept/reject is BL-150 +
#    the existing rule_proposal flow, out of scope here.
