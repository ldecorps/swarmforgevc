Feature: promote_and_route enforces every promotion gate at one chokepoint

  # BL-663: three different promotion gates were bypassed in 48 hours, each
  # caught by a human watching, none by machinery — human_approval/assigned_to
  # ignored (standing watch), an Article 3.2.4 expedite-lane violation
  # (BL-572 promoted over BL-647/BL-648), and assigned_to silently flipped
  # specifier -> coder at promote time, skipping the spec stage (BL-647,
  # de5b5d323). The swarm now runs unattended shifts, so a skipped gate is a
  # night lost, not a caught mistake. One enforcement layer, every gate,
  # refusing with a named reason.

  # BL-663 pending-approval-never-promotes-01
  Scenario: a ticket with pending human_approval is refused promotion
    Given a paused ticket whose human_approval is pending
    When promote_and_route evaluates it as a promotion candidate
    Then the ticket is not promoted
    And the refusal names the human_approval gate as the reason

  # BL-663 specifier-assigned-routes-to-specifier-not-coder-02
  Scenario: a ticket assigned to the specifier routes to the specifier, never coder
    Given a paused ticket whose assigned_to is specifier
    When promote_and_route promotes and routes it
    Then the ticket is routed to the specifier
    And assigned_to is not silently rewritten to coder as a side effect of the promote commit

  # BL-663 expedite-lane-enforced-03
  Scenario: an expedited defect is promoted ahead of a non-expedited ticket regardless of priority number
    Given a paused defect ticket with severity high
    And a paused feature ticket with a numerically better priority sits alongside it
    When promote_and_route selects the next candidate
    Then the expedited defect is promoted
    And the feature ticket is not promoted ahead of it

  # BL-663 existing-gates-still-enforced-04
  Scenario Outline: depth, orthogonality, and hold markers are enforced through the same chokepoint
    Given a paused ticket that would violate the <existing gate>
    When promote_and_route evaluates it as a promotion candidate
    Then the ticket is not promoted
    And the refusal names the <existing gate> as the reason

    Examples:
      | existing gate            |
      | active_backlog_max_depth |
      | orthogonality overlap    |
      | a hold marker            |

  # BL-663 compliant-promotion-passes-unchanged-05
  Scenario: a fully compliant promotion passes unchanged
    Given a paused ticket with human_approval approved
    And its assigned_to correctly reflects the spec-stage-first routing
    And it is the correctly-laned next candidate under Article 3.2.4
    And it violates no depth, orthogonality, or hold gate
    When promote_and_route evaluates it as a promotion candidate
    Then the ticket is promoted and routed exactly as today
