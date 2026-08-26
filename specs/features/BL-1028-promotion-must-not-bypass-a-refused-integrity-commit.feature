# mutation-stamp: sha256=dcb9801434b8200d452f08341d8483d52f0c1db127105f964f631d6b9046553e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T14:18:17.036861206Z","feature_name":"a promotion never bypasses an integrity commit that refused","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1028-promotion-must-not-bypass-a-refused-integrity-commit.feature","background_hash":"8dfb43339a755a9a1cd0a40262f6a6cde8461598f483ef288f9cfe4d146b86fd","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a refused integrity commit is never overridden by a raw commit","scenario_hash":"83487217bc49eca1c3e726835eae24c4e71c5717d4b2d08c68f1c87ca91e3978","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-22T14:18:13.210748988Z"},{"index":1,"name":"a promotion that does not commit leaves the index as it found it","scenario_hash":"ae205593bd1ffbf14db1e154396ff884066a5cdd6baf01d6014f0b8d0994f721","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-22T14:18:13.210748988Z"}]}
# acceptance-mutation-manifest-end

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
