Feature: the deprecator freshness gate honours a recorded specifier adjudication

  # BL-1267 (epic deprecator, incidents BL-1190 2026-08-27 and BL-1256
  # 2026-08-29): Article 3.6 gives the specifier four outcomes on a hold —
  # amend, retire, split, confirm promote. The fourth has nowhere to be
  # recorded that deprecate-check.js reads, so the CLI recomputes the same
  # hold from ticket text on every call and promote_and_route_next.sh
  # refuses fail-closed before the git-mv, forever. Worse, the adjudication
  # the specifier writes into the ticket contains the very words
  # ("superseded", "retired", "obsolete") the generic-claim branch matches,
  # so recording the remedy arms the gate against the ticket it cleared.
  # This slice gives confirm-promote a durable representation the gate reads,
  # fingerprinted against the ticket content it was made against.

  Background:
    Given the Article 3.6 deprecator freshness gate is in force
    And a paused ticket the freshness check holds on its ticket text

  # BL-1267 adjudication-discharges-the-hold-01
  Scenario: a confirm-promote adjudication recorded against the current ticket content allows
    Given a recorded adjudication for that ticket's current content with outcome "confirm_promote"
    When the deprecator freshness check runs for that ticket
    Then the decision is allow
    And the allow names the adjudication record

  # BL-1267 amendment-re-arms-the-gate-02
  Scenario: amending the ticket after adjudication re-arms the gate
    Given a recorded adjudication for that ticket's current content with outcome "confirm_promote"
    When the ticket content is amended after the adjudication was recorded
    And the deprecator freshness check runs for that ticket
    Then the decision is hold
    And the reason names the adjudication as no longer matching the ticket

  # BL-1267 only-confirm-promote-discharges-03
  Scenario Outline: only the confirm-promote outcome discharges a hold
    Given a recorded adjudication for that ticket's current content with outcome "<outcome>"
    When the deprecator freshness check runs for that ticket
    Then the decision is "<decision>"

    Examples:
      | outcome         | decision |
      | confirm_promote | allow    |
      | amend           | hold     |
      | retire          | hold     |
      | split           | hold     |

  # BL-1267 unreadable-adjudication-fails-closed-04
  Scenario: an unreadable or malformed adjudication record fails closed
    Given an adjudication record for that ticket that cannot be read or parsed
    When the deprecator freshness check runs for that ticket
    Then the decision is hold
    And the reason names the unusable adjudication rather than treating it as allow

  # BL-1267 no-record-keeps-the-original-reason-05
  Scenario: a held ticket with no adjudication record holds with its original reason
    Given no adjudication record exists for that ticket
    When the deprecator freshness check runs for that ticket
    Then the decision is hold
    And the reason is the stale-premise reason the gate produced before this slice

  # BL-1267 promote-path-honours-the-discharge-06
  Scenario Outline: the real promotion script promotes a discharged ticket and only a discharged one
    Given a fixture project root containing that paused ticket
    And the fixture ticket's adjudication record is "<adjudication>"
    When promote_and_route_next.sh is run against that fixture root for that ticket
    Then the fixture ticket ends in "<folder>"

    Examples:
      | adjudication    | folder |
      | confirm_promote | active |
      | absent          | paused |
