Feature: BL-1338 the promotion's own routing stamp does not invalidate the adjudication that authorized it

  BL-1267 binds an Article 3.6 adjudication to a fingerprint of the ticket it
  was made against, so amending a ticket after it is cleared correctly re-arms
  the freshness gate. That safety property is right and must survive.

  But `computeTicketFingerprint` is a SHA-256 over the ENTIRE YAML text, and
  `promote_and_route_next.sh` appends `assigned_to: <role>` to the ticket
  AFTER the gate has passed. So the routing stamp written by the promotion
  invalidates the adjudication that authorized that same promotion: the record
  is stale the instant it is successfully used.

  Observed on BL-1271, 2026-09-02: adjudicated and cleared at fingerprint
  a2fff575bfa6, promoted, and the next check reported "recorded a2fff575bfa6,
  ticket is now 7cc9417b4d88 - re-adjudicate". The only difference between the
  two was a blank line and `assigned_to: coder`.

  Cosmetic on a ticket that stays active, but a ticket demoted back to paused
  is re-held and costs a full specifier round trip for a routing stamp - and
  this now happens to EVERY adjudicated ticket.

  Background:
    Given a ticket with a recorded confirm_promote adjudication

  # BL-1338 fingerprint-ignores-the-routing-stamp-01
  Scenario Outline: what re-arms the gate and what does not
    When the ticket changes by <change>
    Then the recorded adjudication <verdict>

    Examples:
      | change                                  | verdict            |
      | the routing stamp a promotion writes    | still matches      |
      | an edit to its acceptance criteria      | no longer matches  |
      | an edit to its description              | no longer matches  |

  # BL-1338 substantive-change-still-re-arms-02
  # The safety property BL-1267 exists for. Narrowing what the fingerprint
  # covers must never let an amended spec ride a stale clearance.
  Scenario: a spec amendment after clearance still demands re-adjudication
    Given the ticket's spec is amended after the adjudication was recorded
    When the freshness gate is consulted
    Then it holds and names re-adjudication as the remedy

  # BL-1338 promoted-ticket-stays-clear-03
  Scenario: a cleared ticket that was promoted is still clear on re-check
    Given the ticket has been promoted and carries its routing stamp
    When the freshness gate is consulted
    Then it allows, naming the adjudication record
