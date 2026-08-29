Feature: the freshness gate's generic-claim branch fires on a claim about this ticket, not any prose mention

  # BL-1268 (epic deprecator, sibling of BL-1193 which fixes a DIFFERENT
  # branch of the same CLI — the retired-token extractor): deprecate-check.js
  # holds whenever STALE_CLAIM_RE — /\b(superseded-by|superseded|retired|
  # obsolete)\b/i — matches anywhere in a candidate's YAML text and no
  # backlog/done/ closure exists for that ticket id. It cannot tell "this
  # ticket is superseded" from "this ticket explains why some OTHER ticket
  # was". A ticket's notes: field is exactly where such cross-references
  # belong, so correct bookkeeping reads as a stale premise. Measured
  # 2026-08-29: 29 of 114 paused tickets held, 24 of them on this one branch,
  # including every deprecator ticket and every ticket carrying a recorded
  # adjudication.

  Background:
    Given the Article 3.6 deprecator freshness gate is in force

  # BL-1268 claim-must-name-this-ticket-01
  Scenario Outline: only a claim about this ticket holds the generic-claim branch
    Given a paused ticket whose text carries "<claim_shape>"
    And its backlog/done/ closure is "<closure>"
    When the deprecator freshness check runs for that ticket
    Then the decision is "<decision>"

    Examples:
      | claim_shape                                              | closure | decision |
      | a notes line saying another ticket was superseded         | absent  | allow    |
      | a notes line saying another ticket's logic was retired    | absent  | allow    |
      | a closed_as field naming this ticket as superseded-by     | absent  | hold     |
      | a description sentence calling this ticket itself obsolete | absent | hold     |
      | a closed_as field naming this ticket as superseded-by     | present | allow    |

  # BL-1268 recorded-adjudication-is-not-a-self-claim-02
  Scenario: a specifier's recorded adjudication text is not itself a claim about the ticket
    Given a paused ticket whose only claim words appear inside a recorded deprecator adjudication
    And its backlog/done/ closure is "absent"
    When the deprecator freshness check runs for that ticket
    Then the decision is allow

  # BL-1268 reason-names-the-claim-it-found-03
  Scenario: a genuine self-claim hold names the field the claim was found in
    Given a paused ticket whose text carries "a closed_as field naming this ticket as superseded-by"
    And its backlog/done/ closure is "absent"
    When the deprecator freshness check runs for that ticket
    Then the decision is hold
    And the reason names the field carrying the claim
