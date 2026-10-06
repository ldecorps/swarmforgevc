Feature: BL-2030 qa-gather's straggler check counts only the gathering worktree's own runs

  qa-gather's straggler rows run a host-wide pgrep for test and mutation
  runs, so another role's live run (the hardener's Stryker, a coder seat's
  property lane) reads as a QA straggler. Three times QA attributed one by
  hand through /proc before trusting the row (verification-debt category
  straggler-owner-attribution). The check now names the worktree each
  matched run belongs to and counts as a straggler only a run under the
  worktree the gather runs from.

  # BL-2030 straggler-owner-01
  Scenario Outline: a matched run counts as a straggler only under the gathering worktree
    Given a "<tool>" run whose working directory is in the "<worktree>" checkout
    When qa-gather's straggler check runs from the QA worktree
    Then the check reports <verdict>
    And the row lists that run under "<worktree>"

    Examples:
      | tool        | worktree  | verdict             |
      | vitest      | QA        | an own straggler    |
      | stryker     | hardender | no own straggler    |
      | vitest      | coder2    | no own straggler    |
      | node --test | master    | no own straggler    |
