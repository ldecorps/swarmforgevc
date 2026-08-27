Feature: Live Screen shows at most one primary working seat per ticket

  The Live Screen role grid must answer "who is doing what" without painting
  the same BL as the primary working ticket on multiple seats. Attribution
  follows live in_process claims and pane truth — not a per-role fallback that
  repeats one id across unrelated tiles. Sibling to
  BL-1188 (pipeline STATUS GRID parity); share working-now semantics but do
  not block each other.

  Background:
    Given the Live Screen is authenticated under a standing full pack
    And each role tile resolves its held ticket from live capture

  # BL-1189 unique-primary-seat-01
  Scenario: A ticket claimed by one role is the primary working ticket on at most one tile
    Given ticket "BL-600" is claimed in_process only at "documenter"
    And roles "coordinator", "cleaner", and "architect" have no in_process claim for "BL-600"
    When the Live Screen capture builds all role tile payloads
    Then exactly one tile shows "BL-600" as its primary working ticket
    And the "documenter" tile is that primary holder

  # BL-1189 post-close-ghost-02
  Scenario: A ticket in backlog done drops from all tiles within one capture TTL
    Given ticket "BL-600" was bookkeep-closed into backlog done one tick ago
    And no role holds an in_process parcel for "BL-600"
    When the Live Screen capture runs twice within one capture TTL
    Then no tile shows "BL-600" as its primary working ticket

  # BL-1189 stale-residual-not-equal-03
  Scenario: Stale mailbox residue on other roles does not show as equal working now
    Given ticket "BL-600" is claimed in_process only at "qa"
    And role "coordinator" still has a stale stage-map entry naming "BL-600"
    When the Live Screen capture builds all role tile payloads
    Then the "qa" tile shows "BL-600" as its primary working ticket
    And the "coordinator" tile does not show "BL-600" as primary working now

  # BL-1189 prefer-live-pane-04
  Scenario: When claims disagree the seat whose live pane agrees wins primary attribution
    Given ticket "BL-1175" appears in stale held lists for "cleaner" and "architect"
    And ticket "BL-1175" is claimed in_process only at "hardender" after stale lists exist
    When the Live Screen capture builds all role tile payloads
    Then the "hardender" tile shows "BL-1175" as its primary working ticket
    And roles "cleaner" and "architect" do not show "BL-1175" as primary working now

  # BL-1189 batch-role-marked-05
  Scenario: A batch seat holding several parcels may name the oldest claim and counts the rest
    Given the "cleaner" seat holds tickets "BL-1010", "BL-1011", and "BL-1014" in_process
    And no other seat holds any of those tickets in_process
    When the Live Screen capture builds all role tile payloads
    Then the "cleaner" tile shows "BL-1010" as its primary working ticket
    And the "cleaner" tile shows that "2" further parcels are held
    And no other tile shows any of "BL-1010", "BL-1011", or "BL-1014" as primary working now
