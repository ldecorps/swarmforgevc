Feature: reconciling a genuine two-way divergence absorbs it with a real merge instead of resetting local main away

  # BL-1214 (epic swarm-reliability). Found 2026-08-27 by the coder while
  # verifying BL-1198: scenario 02 of the standing shell test
  # swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh
  # ("a genuine two-way divergence reconciles with BOTH the landed commit and
  # the local-only bookkeeping commit reachable") fails identically with and
  # without BL-1198's fix — a separate, pre-existing defect, confirmed by the
  # coder via `git stash` A/B and re-traced by the specifier by reading the
  # code (backlog/evidence/BL-1198-preexisting-two-way-divergence-reset-
  # defect-20260827.md).
  #
  # Mechanism: master_main_reconcile_lib.bb's absorb-dispatch-plan resolves
  # behind>0 + ahead>0 + no-predicted-conflict to :ff-absorb, but every
  # executor of that plan (handoffd.bb's master-main-reconcile-merge!,
  # swarm_heal.bb's inline :merge!, post_hotfix_merge_origin.bb's absorb)
  # only ever runs `git merge --ff-only --no-edit origin/main`. A genuine
  # two-way divergence can never fast-forward, whatever its content, so that
  # merge always fails, no MERGE_HEAD is created, and the :else branch falls
  # straight to `git reset --hard origin/main` — discarding the local-only
  # commit outright. The plan says "absorb"; the execution can only
  # fast-forward. Nothing between the two ever attempts the plain 3-way merge
  # that would resolve the non-conflicting case losslessly.
  #
  # BL-1198 (push-before-reset) cannot save this case and is not a duplicate:
  # under a genuine two-way divergence `git push origin main` is legitimately
  # rejected too. Pushing and resetting are both wrong here; merging is right.
  #
  # The designed behaviour this must NOT regress (BL-1120/BL-1130/BL-1131/
  # BL-1135/BL-1138): the reconcile path never leaves a conflicted merge for
  # an operator to finish, and never aborts a merge it did not itself start.

  Background:
    Given local main and origin/main have each advanced since their common ancestor, so the two refs genuinely diverge

  # BL-1214 non-conflicting-divergence-absorbs-by-merge-01
  Scenario: A non-conflicting two-way divergence is absorbed by a real merge, losing nothing
    Given the diverging commits on each side touch no common path
    When the master-main reconcile path runs
    Then the fast-forward attempt with origin/main fails
    And a 3-way merge with origin/main is attempted
    And the local-only commit remains reachable from local main
    And the commit landed on origin/main remains reachable from local main
    And local main's tip is a merge commit with two parents
    And no reset of local main to origin/main is performed

  # BL-1214 conflicting-divergence-still-rematches-02
  Scenario: A conflicting two-way divergence still falls back to today's reset recovery, leaving no conflicted merge behind
    Given the diverging commits on each side change the same path incompatibly
    When the master-main reconcile path runs
    Then a 3-way merge with origin/main is attempted
    And that merge attempt is aborted before any recovery proceeds
    And no conflicted merge state remains for an operator to finish
    And local main is reset to origin/main exactly as it is today

  # BL-1214 foreign-merge-in-progress-is-never-touched-03
  Scenario: A merge already in progress when the path runs is left entirely alone
    Given a merge started by someone other than this path is already in progress on local main
    When the master-main reconcile path runs
    Then no merge with origin/main is attempted
    And no merge is aborted
    And no reset of local main to origin/main is performed
