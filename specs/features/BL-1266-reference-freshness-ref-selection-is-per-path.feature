# mutation-stamp: sha256=ec0feb1340b1c1b566fb4b6839ee1ce7b43018b231407975ba38d8cd6650f3ff
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-29T09:53:49.077126364Z","feature_name":"The reference-freshness guard asks about every ref, per path","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1266-reference-freshness-ref-selection-is-per-path.feature","background_hash":"de20b0ab93e07466d0e0de695d6927c895507d67edbffc17d90dc1e2c157b007","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A missing amendment is caught whichever ref carries it","scenario_hash":"73ff38d518b93e0d1ad2f368ee5118052739328af9ae66d8b6a4cdf66ab76a41","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-29T09:53:49.077126364Z"}]}
# acceptance-mutation-manifest-end

Feature: The reference-freshness guard asks about every ref, per path
  BL-640's pre-turn guard refuses a role's turn when its copy of
  swarmforge/constitution/articles/reference/ is missing an amendment. BL-1237
  made that verdict direction-aware, but it left the ref SELECTION alone:
  freshest-main-ref compares whole-repo ahead-counts between local main and
  origin/main and asks the winner about all five reference files.

  A repository-wide commit count is not an answer to "which ref carries the
  newer version of this one file". When the higher-counting ref is the one
  BEHIND on a reference path, two things go wrong at once. A worktree that
  genuinely has not merged the other ref's amendment matches the behind ref
  byte-for-byte and is allowed - the drift BL-640 exists to catch is silently
  missed. And a worktree that HAS merged it differs from the behind ref and is
  refused, with a refusal naming the ref it was never compared against.

  The verdict for a path must be computed from that path's own history in every
  ref that carries it, and a refusal must name the ref whose amendment is
  actually missing.

  Background:
    Given a role worktree, local main and origin/main all carry the reference elaboration files

  # BL-1266 reference-freshness-ref-selection-01
  Scenario Outline: A missing amendment is caught whichever ref carries it
    Given <ref> carries an amendment to a reference file the worktree has never merged
    And the whole-repo ahead-count makes the other ref the higher-counting one
    When the role runs its pre-turn freshness guard
    Then the turn is refused
    And the refusal names that file
    And the refusal names <ref> as the ref whose amendment is missing
    And performing the remedy the refusal names clears the refusal on the next run

    Examples:
      | ref         |
      | local main  |
      | origin/main |

  # BL-1266 reference-freshness-ref-selection-02
  Scenario: A worktree carrying both refs' amendments is allowed even when the refs disagree
    Given local main and origin/main disagree on a reference file
    And the worktree's history contains both refs' most recent commits touching that file
    When the role runs its pre-turn freshness guard
    Then the turn is allowed
    And the worktree's copy of that file is left untouched

  # BL-1266 reference-freshness-ref-selection-03
  Scenario: A repository with no origin/main is judged against local main alone
    Given the repository has no origin/main ref
    And the worktree's copy of every reference file matches local main
    When the role runs its pre-turn freshness guard
    Then the turn is allowed
