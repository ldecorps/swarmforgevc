Feature: a promotion never bypasses an integrity commit that refused

  promote_and_route_next.sh stages its paused -> active rename with `git mv`
  and only afterwards asks commit_integrity_cli.bb to commit it. The CLI exits
  non-zero for :lock-timeout, :verify-mismatch, :add-failed, :commit-failed and
  for a close-guard rejection. The script answers every one of those the same
  way, with `|| { git add -A ...; git add -u ...; git commit -m ... }`.

  That fallback is the defect twice over. It runs a raw, unlocked, hand-rolled
  commit in exactly the concurrent-writer case the lock exists to prevent -
  the thing commit_integrity's own header says must never happen - and it does
  so on the shared master checkout every role writes to. When the fallback
  itself also fails, the `git mv` from the top of the block is still staged and
  nothing unwinds it, so the index is left holding a rename nobody committed.

  commit_integrity is not at fault here and needs no change: its contract is to
  leave a caller's PRE-staged rename exactly as it found it, and it keeps that
  contract. The missing half is the caller's - promotion has no rollback for a
  rename it staged itself, and no refusal path that respects a refusal.

  Background:
    Given the index holds nothing staged
    And an eligible paused ticket ready to promote

  # BL-1028 refusal-is-not-bypassed-01
  Scenario Outline: a refused integrity commit is never overridden by a raw commit
    When the integrity CLI refuses the promotion commit with <reason>
    Then no commit is created for the promotion
    And the promotion reports failure naming <reason>

    Examples:
      | reason           |
      | lock-timeout     |
      | verify-mismatch  |
      | commit-failed    |
      | close-guard      |

  # BL-1028 refusal-leaves-index-clean-02
  Scenario Outline: a promotion that does not commit leaves the index as it found it
    When the integrity CLI refuses the promotion commit with <reason>
    Then the paused -> active rename is no longer staged
    And the ticket file is back at its paused path

    Examples:
      | reason           |
      | lock-timeout     |
      | verify-mismatch  |
      | commit-failed    |
      | close-guard      |

  # BL-1028 successful-promotion-still-commits-03
  Scenario: an accepted integrity commit still promotes normally
    When the integrity CLI accepts the promotion commit
    Then a commit is created for the promotion
    And the ticket file is at its active path
    And the index holds nothing staged

  # BL-1028 absent-cli-degrades-loudly-04
  Scenario: a target repo with no integrity CLI still promotes, and says so
    Given the integrity CLI is not present in the target repo
    When the promotion runs
    Then a commit is created for the promotion
    And the promotion reports that it committed without the integrity guard
