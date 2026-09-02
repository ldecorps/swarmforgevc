Feature: BL-1347 an unanswered role question escalates on the channel a stale approval ask already uses

  BL-584 gave an unanswered approval ask a second channel: past a threshold the
  concierge tick emails ONE digest, oldest first, every line deep-linking the
  exact Telegram message. A clarifying question raised with role_ask.bb has no
  such channel. It posts once into the asking role's own topic and then waits
  indefinitely.

  The harm is larger than a slow answer. A role may hold only ONE outstanding
  question, so an unanswered one silently closes that role's only way to ask
  anything at all - and nothing anywhere says so.

  Observed: the specifier's slot was held from 2026-08-30 16:18Z to at least
  2026-09-02 18:44Z by a single unanswered question. Across those three days a
  raw backlog-root intake stayed undrained, because the clarification it needed
  could not be raised while the slot was held, and each day's recheck could do
  nothing but record that the block was unchanged.

  Background:
    Given the front-desk concierge tick runs the stale-ask sweep

  # BL-1347 an-unanswered-role-question-escalates-01
  Scenario: A role question unanswered past the threshold reaches the digest
    Given a role has an outstanding question older than the stale threshold
    When the sweep runs
    Then a digest is sent naming that role and how long its question has waited
    And that line says the role can raise no further question until it is answered

  # BL-1347 an-unanswered-role-question-escalates-02
  Scenario: A question younger than the threshold is left alone
    Given a role has an outstanding question younger than the stale threshold
    When the sweep runs
    Then no digest is sent

  # BL-1347 an-unanswered-role-question-escalates-03
  Scenario: A role with no outstanding question is never escalated
    Given a role has no outstanding question
    When the sweep runs
    Then no digest is sent

  # BL-1347 an-unanswered-role-question-escalates-04
  Scenario: One absence sends one email, not two
    Given a role has an outstanding question older than the stale threshold
    And a ticket has an approval ask older than the stale threshold
    When the sweep runs
    Then one digest is sent naming both the role question and the approval ask

  # BL-1347 an-unanswered-role-question-escalates-05
  Scenario Outline: A missing posted message costs the link, never the line
    Given a role has an outstanding question older than the stale threshold
    And the Telegram message that posted it is "<message>"
    When the sweep runs
    Then the digest names that role
    And its deep link is "<link>"

    Examples:
      | message  | link    |
      | recorded | present |
      | unknown  | absent  |

  # BL-1347 an-unanswered-role-question-escalates-06
  Scenario: A second sweep inside the cooldown stays silent
    Given a role has an outstanding question older than the stale threshold
    And a digest was sent less than the cooldown ago
    When the sweep runs
    Then no digest is sent
