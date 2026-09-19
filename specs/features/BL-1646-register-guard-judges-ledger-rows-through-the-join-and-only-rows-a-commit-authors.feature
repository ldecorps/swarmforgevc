Feature: BL-1646 The register guard judges ledger rows through the register's join and only rows the commit authors

  check_standing_red_register.sh refuses a commit that adds or changes a
  standing-red row naming a ticket that is not open. For a hardening-debt
  ledger row it reads the bare parcel id, although the register's own join
  treats the row as owned once a register row names an open ticket for the
  same file set, and it diffs the staged tree against HEAD alone, so a
  branch merge of main is charged with every line the branch lacked. On
  2026-09-19 coder@2's routine merge of main was refused over the BL-831
  row that BL-1643 owns through the register. After this parcel the guard
  decides a ledger row's owner through the same join the register CLI uses,
  judges a merge commit only on rows absent from both parents, and still
  refuses any commit that itself authors a row naming a closed ticket.

  Background:
    Given a git fixture with a main branch and a role branch forked before main gained a hardening-debt ledger row for parcel BL-4242
    And on main the ticket BL-4242 is closed
    And the real guard runs from the fixture root on the staged commit

  # BL-1646 a-merge-inheriting-an-owned-ledger-row-passes-01
  Scenario: a merge of main inheriting a ledger row whose file set the register assigns to an open ticket passes
    Given the staged register names the open paused ticket BL-4343 as owner of the ledger row's file set in the hardening lane
    When the role branch stages a merge of main
    Then the guard passes

  # BL-1646 a-merge-inheriting-an-unowned-ledger-row-is-not-the-mergers-fault-02
  Scenario: a merge of main inheriting a ledger row with no register owner passes because the merger authored nothing
    Given the staged register names no owner for any hardening row
    When the role branch stages a merge of main
    Then the guard passes

  # BL-1646 a-merge-that-itself-authors-a-row-naming-a-closed-ticket-is-refused-03
  Scenario: a merge whose resolution adds a ledger row present in neither parent naming a closed ticket is refused
    Given the staged register names no owner for any hardening row
    When the role branch stages a merge of main and adds a ledger row for the closed parcel BL-4444 present in neither parent
    Then the guard refuses naming the BL-4444 row

  # BL-1646 a-linear-commit-adding-a-row-with-an-open-register-owner-passes-04
  Scenario: a linear commit adding a ledger row for a closed parcel passes when the staged register names an open owner for its file set
    Given the staged register names the open paused ticket BL-4343 as owner of the ledger row's file set in the hardening lane
    When the role branch stages a linear commit adding a ledger row for the closed parcel BL-4444
    Then the guard passes

  # BL-1646 a-linear-commit-adding-an-unowned-row-for-a-closed-ticket-is-refused-05
  Scenario: a linear commit adding a ledger row for a closed parcel with no register owner is refused
    Given the staged register names no owner for any hardening row
    When the role branch stages a linear commit adding a ledger row for the closed parcel BL-4444
    Then the guard refuses naming the BL-4444 row

  # BL-1646 the-register-row-rule-is-unchanged-06
  Scenario: a linear commit adding a register row naming a closed ticket is still refused
    When the role branch stages a linear commit adding a register row naming the closed ticket BL-4242
    Then the guard refuses naming the BL-4242 row
