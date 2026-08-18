# mutation-stamp: sha256=58a43364070b1f0441380efede043a4172b7e412ab73c1d43cfd075ee26e9055
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-18T00:10:11.410714Z","feature_name":"a commit-time hook refuses pipeline code on main from any role but QA","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-632-commit-time-guard-refuses-pipeline-code-on-main.feature","background_hash":"27f86c6f7bb3919ded2654bc0de4b7adc0ae038677aded0c5d93251d5744f34b","implementation_hash":"unknown","scenarios":[{"index":2,"name":"a bookkeeping-only commit on main is allowed with no role set","scenario_hash":"e3444f9e487c67b5d9783e4ade147d02acd4bac3752ef18776f8313b957bf305","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-18T00:10:11.410714Z"},{"index":5,"name":"the existing commit-size guard keeps firing independently","scenario_hash":"04e2aad046b0fa6aa8a5e0937958d0e8eed4e4fd2ac8a99b7728b9a6d53dd168","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-18T00:10:11.410714Z"}]}
# acceptance-mutation-manifest-end

Feature: a commit-time hook refuses pipeline code on main from any role but QA

  # BL-632, closing the BL-590 post-mortem 2026-07-25: BL-629 (deploy gate),
  # BL-630 (publish gate) and BL-631 (detection) all react to a bad main tip
  # that already exists. This is the only layer that stops it from existing.
  # core.hooksPath already points at the versioned swarmforge/git-hooks, and
  # every worktree shares one physical git dir, so one hook covers every
  # role. Two hooks are needed: pre-commit (plain git commit) and
  # pre-merge-commit (git merge --no-ff, the handoff path's merge_and_process
  # shape) — a fast-forward merge and git reset --hard/branch -f/cherry-pick
  # remain uncaught by design, which is why BL-630 and BL-631 still ship.

  Background:
    Given the QA-exclusive path set is extension/src/, extension/test/, and specs/pipeline/steps/

  # BL-632 non-qa-commit-on-main-refused-01
  Scenario: a non-QA commit touching pipeline code on main is refused
    Given the current branch is main
    And SWARMFORGE_ROLE is not QA
    And the staged change touches extension/src/
    When a commit is attempted
    Then the commit is refused with a non-zero exit
    And the message names the offending path(s) and the reason

  # BL-632 qa-role-allowed-02
  Scenario: the same change is allowed under the QA role
    Given the current branch is main
    And SWARMFORGE_ROLE is QA
    And the staged change touches extension/src/
    When a commit is attempted
    Then the commit succeeds

  # BL-632 bookkeeping-commit-on-main-allowed-03
  Scenario Outline: a bookkeeping-only commit on main is allowed with no role set
    Given the current branch is main
    And SWARMFORGE_ROLE is not set
    And the staged change touches only <bookkeeping path>
    When a commit is attempted
    Then the commit succeeds

    Examples:
      | bookkeeping path |
      | backlog/           |
      | docs/               |
      | specs/features/     |
      | swarmforge/         |

  # BL-632 non-main-branch-unaffected-04
  Scenario: a commit on any branch other than main is never refused by this guard
    Given the current branch is swarmforge-cleaner
    And the staged change touches extension/src/
    When a commit is attempted
    Then the commit succeeds

  # BL-632 merge-no-ff-refused-05
  Scenario: a --no-ff merge of pipeline code into main is refused by pre-merge-commit
    Given the current branch is main
    And SWARMFORGE_ROLE is not QA
    And the incoming branch carries changes to extension/src/
    When a merge --no-ff is attempted
    Then the merge commit is refused with a non-zero exit
    And the message names the offending path(s) and the reason

  # BL-632 size-guard-still-runs-06
  Scenario Outline: the existing commit-size guard keeps firing independently
    Given the current branch is main
    And <branch guard scenario>
    When a commit is attempted
    Then the branch guard passes it
    And the commit-size guard still refuses an oversized file when its own condition is met

    Examples:
      | branch guard scenario                                       |
      | the staged change touches only backlog/ (no size issue)     |
      | SWARMFORGE_ROLE is QA and the change touches extension/src/  |

  # BL-632 refusal-message-states-remedy-07
  Scenario: the refusal message states the remedy
    Given the current branch is main
    And SWARMFORGE_ROLE is not QA
    And the staged change touches specs/pipeline/steps/
    When a commit is attempted
    Then the refusal message states committing in your own worktree and handing off through the pipeline as the remedy
