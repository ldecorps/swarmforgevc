# mutation-stamp: sha256=282354f4b4d591843fb762c626142cf9bac66d8b97dd8218dd3d9643204c12fa
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T03:34:28.843316956Z","feature_name":"BL-1344 an investigated babysitter finding can be waived, and stays waived","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1344-an-investigated-finding-can-be-waived.feature","background_hash":"e542ee4586eafc23f5665fc6fc0c289cd701432845ad4719279d1da63904445d","implementation_hash":"unknown","scenarios":[{"index":5,"name":"An unusable waive store alerts rather than going quiet","scenario_hash":"49e31ee74385d0b1959e5bba27b2b2617e73ae3dcf6f7598527bed07196f374e","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-03T03:34:28.843316956Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1344 an investigated babysitter finding can be waived, and stays waived

  The babysitter's health sweep dedups a nudge on a rolling 30-minute
  cooldown, which is the right shape for a condition that will clear. A
  finding over permanent history never clears, so the cooldown only spaces out
  a nudge that will fire again for as long as the swarm runs. There is no way
  to record "investigated, legitimate, stop asking" the way a hotfix can be
  decided in the certification ledger.

  This adds that close-out, and bounds it: a waive names one finding, only a
  recorded decision creates one, and anything unreadable alerts rather than
  going quiet.

  Background:
    Given the babysitter sweep produces a finding with a stable finding key

  # BL-1344 an-investigated-finding-can-be-waived-01
  Scenario: A waived finding stops nudging
    Given a recorded waive for that finding key
    When the sweep runs
    Then no nudge is sent for that finding

  # BL-1344 an-investigated-finding-can-be-waived-02
  Scenario: An un-waived finding still nudges
    Given no recorded waive for that finding key
    And the nudge cooldown for it has elapsed
    When the sweep runs
    Then a nudge is sent for that finding

  # BL-1344 an-investigated-finding-can-be-waived-03
  Scenario: A waive suppresses only the finding it names
    Given a recorded waive for a different finding key
    When the sweep runs
    Then a nudge is sent for that finding

  # BL-1344 an-investigated-finding-can-be-waived-04
  Scenario: The sweep never waives a finding itself
    Given no recorded waive for that finding key
    When the sweep runs
    Then no waive exists for that finding key afterwards

  # BL-1344 an-investigated-finding-can-be-waived-05
  Scenario: A waive is discoverable, never a silent deletion
    Given a recorded waive for that finding key
    When the waived findings are listed
    Then the listing names that finding key, who waived it and the stated reason

  # BL-1344 an-investigated-finding-can-be-waived-06
  Scenario Outline: An unusable waive store alerts rather than going quiet
    Given the waive store is "<state>"
    When the sweep runs
    Then a nudge is sent for that finding

    Examples:
      | state        |
      | unreadable   |
      | malformed    |
