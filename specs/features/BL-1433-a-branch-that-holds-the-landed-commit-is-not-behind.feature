Feature: BL-1433 A branch that holds the landed commit is not behind

  The post-QA branch sweep (BL-668) fast-forwards clean role branches to the
  landed commit and, since BL-1361, tells a role whose branch it could not
  settle why. BL-1421 made that telling standing: a role told once is not
  told again until its HEAD has caught up to the commit it was told about.
  The sweep's classification calls every branch it cannot fast-forward
  "divergent", including a branch that already contains the landed commit
  and merely carries the role's own commits on top - the ordinary state of
  every role mid-parcel after it merged main. For such a branch "caught up
  to the told commit" is true from the start, so BL-1421's suppression
  never holds, and the sweep told four roles "branch behind <sha>: branch
  cannot fast-forward to landed commit - merge up" every cycle: 61 notes
  in fifteen minutes on 2026-09-05, starting six minutes after the daemon
  restarted on BL-1421's code, each one asking for a merge with nothing to
  merge.

  This feature is that a branch whose HEAD contains the landed commit is
  settled for the sweep's purpose and is told nothing, whatever else the
  worktree holds; that divergent means HEAD lacks the landed commit and
  cannot fast-forward to it, for which BL-1421's standing surfacing holds
  unchanged; and that the daemon's fact supplier answers containment from
  the role's own worktree. Scenarios 01, 02 and 04 run over pure sweep
  state and facts as BL-1421's do; scenario 03 runs the supplier against a
  git fixture under a temporary directory, never the live checkout.

  Background:
    Given a fixture sweep state and a landed commit

  # BL-1433 a-branch-holding-the-landed-commit-is-settled-01
  Scenario Outline: a branch that holds the landed commit is told nothing whatever else the worktree holds
    Given a role whose HEAD contains the landed commit and is <shape>
    When the sweep runs
    Then the role is told nothing and woken nothing
    And the sweep logs that the role already holds the landed commit

    Examples:
      | shape                                           |
      | ahead by its own commits with a clean worktree  |
      | ahead by its own commits with a dirty worktree  |
      | ahead by its own commits with in_process work   |

  # BL-1433 a-truly-divergent-branch-is-told-once-02
  Scenario: a branch that lacks the landed commit and cannot fast-forward is divergent and told once
    Given a divergent role whose branch lacks the landed commit
    When two consecutive sweeps pass with nothing changed between them
    Then the first sweep tells the role once that its branch cannot fast-forward
    And the second sweep tells it nothing

  # BL-1433 the-supplier-answers-containment-from-the-worktree-03
  Scenario: the daemon's fact supplier reports containment from the role's own worktree
    Given a git fixture where the role's branch is origin/main plus one commit of its own
    When the daemon's fact supplier reads the role
    Then it reports that HEAD contains the landed commit
    And it reports that the branch cannot fast-forward

  # BL-1433 the-2026-09-05-flood-replayed-04
  Scenario: twenty cycles against a branch that is merely ahead produce no note
    Given twenty consecutive sweep cycles over an ahead-only role that holds the landed commit
    When every replayed cycle has completed
    Then no cycle produced a note for that role
