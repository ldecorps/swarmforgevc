Feature: Front desk reads photo captions and logs every dropped update

  # BL-620, defect intake 2026-07-24 (operator root-cause): messageTextOf
  # (extension/src/tools/telegramTopicDecisions.ts:27) reads ONLY
  # update.message?.text, so a principal's photo+caption fails eligibility
  # with "no-text" and is silently dropped - the incident that ate the
  # human's burn-rate directive (now BL-619). Epic swarm-reliability.
  #
  # Two halves, one file cluster:
  #   1. messageTextOf returns text ?? caption; every consumer (main
  #      eligibility/routing, steering, agent-questions, control delivery,
  #      negotiation relay) inherits caption support from that one seam.
  #      The front desk has NO vision: the image itself is never read -
  #      caption-only routing, with the routed content annotated so nobody
  #      believes the image was seen.
  #   2. Drop outcomes become auditable: the reason computed in
  #      checkUpdateEligibility is currently discarded and a dropped update
  #      produces ZERO log output anywhere; diagnosis took a live replay
  #      session. Every drop now logs exactly one bounded line.
  #   Never again silent: a media message from the principal produces either
  #   a routed action or a logged, visible refusal.

  Background:
    Given a front-desk bot bound to its own group with the principal configured

  # BL-620 caption-routes-like-text-01
  Scenario: a photo caption from the principal routes exactly like the same words as text
    Given a backlog topic is registered for the target ticket
    When the principal sends a photo whose caption addresses that topic
    Then the decision equals the decision for the identical plain-text message
    And the decision is not a drop

  # BL-620 every-text-surface-reads-captions-02
  Scenario Outline: every text-reading surface treats a caption as the message text
    Given the "<surface>" surface receives a principal message carrying only a caption
    When the surface decides its action
    Then the surface treats the caption as the message text

    Examples:
      | surface          |
      | main-routing     |
      | steering         |
      | agent-questions  |
      | control-delivery |
      | negotiation      |

  # BL-620 captionless-media-visible-refusal-03
  Scenario Outline: a media message with no usable caption is refused visibly, never silently
    When the principal sends a photo with <caption_state>
    Then the update is dropped with reason "media-no-caption"
    And exactly one audit line naming the update id and reason "media-no-caption" is logged
    And the poll offset advances past the update

    Examples:
      | caption_state    |
      | no caption       |
      | an empty caption |

  # BL-620 routed-media-image-not-read-receipt-04
  Scenario: a routed caption message is annotated that the image was not read
    Given a backlog topic is registered for the target ticket
    When the principal's photo caption is routed to that topic
    Then the routed content notes the attached image was not read by the front desk

  # BL-620 every-drop-logs-one-line-05
  Scenario Outline: every dropped update logs exactly one bounded reason line
    Given an update that fails eligibility with reason "<reason>"
    When the poll cycle processes the update
    Then exactly one audit line naming the update id and reason "<reason>" is logged
    And the audit line is a single line

    Examples:
      | reason        |
      | not-my-chat   |
      | not-principal |
      | no-text       |

  # BL-620 offset-semantics-unchanged-06
  Scenario: audited drops still advance the offset exactly as before
    Given an update that fails eligibility with reason "no-text"
    When the poll cycle processes the update
    Then the poll offset advances past the update
    And no delivery retry is attempted for it
