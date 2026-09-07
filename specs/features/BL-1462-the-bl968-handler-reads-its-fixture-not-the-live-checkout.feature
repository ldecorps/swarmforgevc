Feature: BL-1462 BL-968's acceptance handler reads its fixture, not the live checkout's bookkeeping or shape

  Two of the four scenarios in BL-968's feature assert facts about the live
  checkout the runner happens to sit in. Scenario 03 reads the ticket's
  YAML from a hard-coded backlog/active path; the ticket closed on
  2026-08-20 and moved to backlog/done, so the scenario has been red since,
  invisible because the acceptance runner runs one feature at a time and
  nobody runs a closed ticket's feature until an e2e procedure names it -
  BL-1450's did, on 2026-09-07. Scenario 04 asserts that the checkout it
  runs in is a linked role worktree, which is true under .worktrees/ and
  false in the master checkout, so the same file is green for the coder and
  red for the specifier. After this parcel the handler finds the ticket
  wherever bookkeeping has put it, using the gate library's own search
  order, and locates a linked role worktree itself instead of asserting it
  is one; a missing precondition fails naming it, never as a false red.

  # BL-1462 the-feature-passes-from-the-master-checkout-with-the-ticket-closed-01
  Scenario: the BL-968 feature passes from the master checkout with its ticket closed
    Given BL-968's ticket YAML lives under backlog/done
    When the BL-968 feature runs from the repository's master checkout
    Then all four of its scenarios pass

  # BL-1462 the-ticket-is-found-wherever-bookkeeping-put-it-02
  Scenario Outline: the handler finds the ticket YAML wherever backlog bookkeeping has put it
    Given a fixture backlog carrying BL-968's ticket YAML under <dir> and nowhere else
    When the handler resolves the ticket YAML for scenario 03 against that fixture
    Then it resolves the file under <dir>

    Examples:
      | dir             |
      | backlog/active  |
      | backlog/paused  |
      | backlog/done    |
      | backlog/done/M8 |

  # BL-1462 the-feature-still-passes-from-a-linked-role-worktree-03
  Scenario: the BL-968 feature still passes from a linked role worktree
    Given a linked role worktree of the repository exists
    When the BL-968 feature runs from that worktree
    Then all four of its scenarios pass

  # BL-1462 the-register-row-leaves-with-the-fix-04
  Scenario: the register row leaves with the fix
    When the fix is on main
    Then backlog/standing-reds.tsv carries no row for BL-968's feature file
