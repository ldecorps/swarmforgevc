Feature: promotion routes by design state, not by a value left over from mint

  The promotion router decides where an eligible ticket goes from its
  assigned_to field, and promotion_gates_lib.bb's route-target treats the
  value "specifier" as a deliberate hold: it routes there and, uniquely,
  never rewrites the field. That hold is real and worth keeping - four
  tickets whose design is genuinely unsettled depend on it.

  But "specifier" is also what mint writes by default. Measured 2026-08-22
  across the 195 committed paused and active tickets: 74 carry it, and only
  4 of those are the ones that still need design. 63 carry no assignment at
  all and 14 name the coder, so three conventions coexist and the field
  records which one the minting session happened to use, not a decision.

  The cost lands at promotion and is paid by the most expensive role. BL-1032
  was fully specced and human-approved, and was routed to the specifier
  anyway; because route-target never rewrites that value, clearing it by hand
  was the only way the ticket could move at all - left alone it would have
  been re-routed to the specifier on every sweep.

  The design state is already recorded, in a field nothing currently reads:
  exactly the four tickets that need design carry status: needs_design, and
  every one of them also carries the stale assignment. Routing on the state
  rather than on the leftover makes the 70 inert values harmless without
  anyone editing them.

  Background:
    Given the promotion router choosing a target for an eligible ticket

  # BL-1047 promotion-routes-by-design-state-01
  Scenario: a settled ticket is not held by an assignment left over from mint
    Given a ticket whose design is settled
    And that ticket carries an assignment naming the specifier
    When the router chooses a target
    Then the ticket is routed to the coder
    And the assignment it records names the coder

  # BL-1047 promotion-routes-by-design-state-02
  Scenario: a ticket whose design is still unsettled keeps its hold
    Given a ticket whose design is still unsettled
    When the router chooses a target
    Then the ticket is routed to the specifier
    And the assignment it records is not rewritten

  # BL-1047 promotion-routes-by-design-state-03
  Scenario: the committed backlog routes as its design state says
    Given every ticket committed in backlog/paused and backlog/active
    When the router chooses a target for each
    Then every ticket whose design is still unsettled is routed to the specifier
    And no other ticket is routed to the specifier
