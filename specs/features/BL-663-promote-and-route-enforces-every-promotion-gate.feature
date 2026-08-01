# mutation-stamp: sha256=ff6e546165f8509bbf1e49b973bbb65f642b7b33f30beba755c4435bfdc19a67
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-01T15:05:04.544532721Z","feature_name":"promote_and_route enforces every promotion gate at one chokepoint","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-663-promote-and-route-enforces-every-promotion-gate.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":3,"name":"depth, orthogonality, and hold markers are enforced through the same chokepoint","scenario_hash":"b0edbe7c28423970cf6b6101f59e6440baace2ad1263104e0d7da891c39942b2","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-01T15:05:04.544532721Z"}]}
# acceptance-mutation-manifest-end

Feature: promote_and_route enforces every promotion gate at one chokepoint

  # BL-663: three different promotion gates were bypassed in 48 hours, each
  # caught by a human watching, none by machinery — human_approval/assigned_to
  # ignored (standing watch), an Article 3.2.4 expedite-lane violation
  # (BL-572 promoted over BL-647/BL-648), and assigned_to silently flipped
  # specifier -> coder at promote time, skipping the spec stage (BL-647,
  # de5b5d323). It recurred a fourth time on 2026-08-01. The swarm now runs
  # unattended shifts, so a skipped gate is a night lost, not a caught
  # mistake. One enforcement layer, every gate, refusing with a NAMED reason —
  # an unnamed refusal is indistinguishable from "no candidate", which is what
  # kept all four instances invisible to machinery.

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
    Given a paused ticket blocked by the <gate> gate
    When promote_and_route evaluates it as a promotion candidate
    Then the ticket is not promoted
    And the refusal names the <gate> gate as the reason

    Examples:
      | gate                     |
      | active_backlog_max_depth |
      | orthogonality            |
      | hold marker              |

  # BL-663 compliant-promotion-passes-unchanged-05
  Scenario: a fully compliant promotion passes unchanged
    Given a paused ticket whose human_approval is approved
    And its assigned_to correctly reflects the spec-stage-first routing
    And it is the correctly-laned next candidate under Article 3.2.4
    And it violates no depth, orthogonality, or hold gate
    When promote_and_route evaluates it as a promotion candidate
    Then the ticket is promoted and routed exactly as today

  # BL-663 promotion-by-name-obeys-the-same-gates-06
  Scenario: promoting a named ticket directly obeys the same gates as auto-selection
    Given a paused ticket whose human_approval is pending
    When promote_and_route is asked to promote that ticket by name
    Then the ticket is not promoted
    And the refusal names the human_approval gate as the reason

  # BL-663 routing-alone-does-not-rewrite-the-assignee-07
  Scenario: routing an active ticket on its own does not rewrite its assignee
    Given an active ticket whose assigned_to is specifier
    When the routing step is invoked on its own, outside a promotion
    Then assigned_to is not silently rewritten to coder as a side effect of the routing step
    And the ticket is routed to the specifier
