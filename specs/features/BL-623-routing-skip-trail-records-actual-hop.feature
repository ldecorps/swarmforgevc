Feature: The routing skip trail records what a hop actually skipped

  # BL-623, operator hawk-watch defect 2026-07-24 on the FIRST production
  # required_stages hop: BL-617's coder pre-routed `to: QA` on a
  # [coder, qa] ticket, and because the literal recipient was already in
  # the effective required set, route-required-stages returned identity
  # (swarm_handoff.bb:434-435) - no routing_skipped header, no
  # .swarmforge/routing-skips.jsonl line, anywhere. The record is produced
  # ONLY on the rewrite branch today. BL-606's visibility guarantee
  # (guardrails #2/#6, scenarios 03/08: "which stages ran vs skipped is
  # answerable from the recorded trail, not inferred from the diff") holds
  # only when senders are naive about routing. Epic swarm-reliability.
  #
  # The fix this ticket pins: the skip record derives from WHAT THE HOP
  # ACTUALLY SKIPPED - canonical stages strictly between sender and the
  # DELIVERED recipient (required_stages_lib.bb hop-skipped-stages, plus
  # the rewritten-away literal recipient on the rewrite branch) - and is
  # emitted whenever that set is non-empty, regardless of who chose the
  # destination. The rewrite branch becomes just one producer of the same
  # record. Recording only: delivery behaviour does not change here.

  Background:
    Given required-stages routing is enabled
    And an active ticket declaring required_stages and stage_skip_reasons

  # BL-623 pre-routed-direct-send-records-01
  Scenario: a sender pre-routing to a later required stage leaves a full skip record
    Given the active ticket declares required_stages of coder and qa
    When the coder sends a git_handoff addressed directly to QA
    Then the delivered parcel carries a routing_skipped header
    And the skip record names cleaner and architect and hardender and documenter as skipped
    And the skip record carries the ticket's declared reason for each skipped stage
    And a routing-skips journal line is appended for the ticket

  # BL-623 rewrite-branch-still-records-02
  Scenario: a rewritten literal recipient still produces the same record shape
    Given the active ticket declares required_stages of coder and qa
    When the coder sends a git_handoff addressed to cleaner
    Then the parcel is delivered to QA
    And the skip record names cleaner and architect and hardender and documenter as skipped
    And a routing-skips journal line is appended for the ticket

  # BL-623 adjacent-hop-no-record-03
  Scenario: an adjacent hop that skips nothing records nothing
    Given the active ticket declares the full canonical chain
    When the documenter sends a git_handoff addressed to QA
    Then the delivered parcel carries no routing_skipped header
    And no routing-skips journal line is appended

  # BL-623 skipped-required-stage-visible-04
  Scenario: skipping over a required stage is recorded even without a declared reason
    Given the active ticket declares required_stages of coder and cleaner and qa
    When the coder sends a git_handoff addressed directly to QA
    Then the parcel is delivered to QA
    And the skip record names cleaner among the skipped stages
    And the skip record carries no declared reason for cleaner
    And the skip record carries the ticket's declared reason for architect

  # BL-623 kill-switch-off-inert-05
  Scenario: with the routing kill-switch off no record is produced
    Given required-stages routing is disabled
    When the coder sends a git_handoff addressed directly to QA
    Then the delivered parcel carries no routing_skipped header
    And no routing-skips journal line is appended

  # BL-623 bounces-never-record-06
  Scenario: a backward bounce never produces a skip record
    Given the active ticket declares required_stages of coder and qa
    When QA sends a git_handoff bounce back to the coder with a rejection reason
    Then the delivered parcel carries no routing_skipped header
    And no routing-skips journal line is appended

  # BL-623 documented-shape-matches-emitted-07
  Scenario: the handoff protocol documents the shapes the code actually emits
    Given the shipped repository documentation
    When the routing-skips section of the handoff protocol is read
    Then its journal example uses the emitted field names
    And its header example uses the emitted header grammar
    And its grep example matches a real emitted journal line
