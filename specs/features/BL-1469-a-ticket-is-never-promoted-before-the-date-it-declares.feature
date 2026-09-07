Feature: BL-1469 A ticket is never promoted before the date it declares

  Some tickets deliver a run the host gates by time rather than by code:
  a Stryker mutation gate under mutation_cooldown_days cannot run until
  three days after the last commit that touched its files. Twice in three
  days such a ticket was promoted into an active slot it could not use:
  BL-1439 on 2026-09-05, which held the swarm at cap one, and BL-1468 at
  14:04Z on 2026-09-07, promoted by the batch promotion after an approval
  sweep although its notes and approval_context named the date, and
  demoted three minutes later on the coder's note. Prose in notes is not a
  gate. This feature gives the ticket a field, not_before, and the
  promotion gates a refusal that names the date, on every path including
  a caller-declared queue-jump; a malformed date refuses and an absent one
  changes nothing. Every scenario runs against a fixture backlog under
  mkdtemp with an injected today (BL-1390; no real clock).

  Background:
    Given a fixture backlog under mkdtemp with a paused, approved ticket, an open slot and an injected today

  # BL-1469 a-future-not-before-is-refused-naming-the-date-01
  Scenario: a ticket whose not_before is in the future is refused naming the date
    Given the ticket declares not_before three days after today
    When the promotion gates evaluate it
    Then it is refused by the not_before gate and the refusal names that date

  # BL-1469 on-or-after-its-date-the-ticket-is-promotable-02
  Scenario Outline: on or after its date the ticket is promotable as before
    Given the ticket declares not_before <when>
    When the promotion gates evaluate it
    Then the not_before gate raises no refusal

    Examples:
      | when      |
      | today     |
      | yesterday |

  # BL-1469 a-malformed-not-before-refuses-rather-than-passes-03
  Scenario: a malformed not_before refuses rather than passes
    Given the ticket declares not_before as text that is not a calendar date
    When the promotion gates evaluate it
    Then it is refused by the not_before gate and the refusal names the value

  # BL-1469 a-ticket-without-not-before-is-judged-as-before-04
  Scenario: a ticket without not_before is judged exactly as before
    Given the ticket declares no not_before
    When the promotion gates evaluate it
    Then the verdict is the one the gates gave before this feature

  # BL-1469 a-queue-jump-still-refuses-a-future-not-before-05
  Scenario: a queue-jump still refuses a future not_before
    Given the ticket declares not_before three days after today
    When the promotion gates evaluate it as a caller-declared queue-jump
    Then it is refused by the not_before gate and the refusal names that date

  # BL-1469 the-promoter-skips-such-a-candidate-and-takes-the-next-06
  Scenario: the promoter skips such a candidate and takes the next
    Given a second paused approved ticket of lower priority with no not_before
    And the first ticket declares not_before three days after today
    When the promoter runs against the fixture
    Then the second ticket is promoted and the first stays paused
