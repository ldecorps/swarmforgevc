Feature: babysitter sweep detects pipeline code landing on main outside the QA path

  # BL-631, BL-590 post-mortem 2026-07-25: the cleaner ran an entire pass in
  # the master checkout (a `cd` habit, not a rotation bug), landing un-QA'd
  # pipeline code on main. Nothing errored and nothing told anyone — an
  # architect found it hours later by eye. BL-629 refuses to deploy, BL-630
  # refuses to publish, BL-632 refuses the commit; this sweep is the only
  # layer that TELLS anyone about a bad tip that already exists.
  #
  # The QA-exclusive path set is deliberately NOT restated here. It is
  # BL-632's, read at runtime from `check_pipeline_code_on_main.sh
  # --list-paths` (scenario 07). Paths named below are example data only,
  # never a second definition — see the ticket's BL-897 note.

  # BL-631 path-set-classification-01
  Scenario Outline: only a QA-exclusive path on a non-QA-ancestor commit fires
    Given a commit reachable from main that is not an ancestor of swarmforge-QA
    And that commit touches only <path>
    When the babysitter sweep runs
    Then the sweep reports <outcome> for that commit

    Examples:
      | path                  | outcome            |
      | extension/src/        | a critical finding |
      | extension/test/       | a critical finding |
      | specs/pipeline/steps/ | a critical finding |
      | backlog/              | no finding         |
      | docs/                 | no finding         |
      | swarmforge/           | no finding         |
      | specs/features/       | no finding         |

  # BL-631 merge-commit-landing-fires-02
  Scenario: a merge commit that brings pipeline code onto main fires
    Given a commit reachable from main that is not an ancestor of swarmforge-QA
    And that commit is a merge whose first-parent diff touches extension/src/
    When the babysitter sweep runs
    Then a critical finding names that commit

  # BL-631 finding-rides-the-standard-nudge-path-03
  Scenario: a critical finding is shaped and routed like every other babysitterd finding
    Given a critical finding was produced for an offending commit
    When the sweep's findings are assembled
    Then the finding carries a key, a severity of CRIT, and a message naming that commit's sha, subject and offending paths
    And it is nudge-eligible on the same rule as every other CRIT finding

  # BL-631 finding-key-is-per-offending-sha-04
  Scenario: the finding's key is specific to the offending commit
    Given a critical finding was produced for an offending commit
    When the finding's key is inspected
    Then the key identifies that commit and no other

  # BL-631 already-nudged-sha-does-not-renudge-05
  Scenario: a sha already nudged does not nudge again on the following sweep
    Given an offending commit sha was nudged as critical on the previous sweep
    And that commit is still reachable from main
    When the babysitter sweep runs again
    Then the finding is produced again
    And no new nudge is sent for that sha

  # BL-631 distinct-sha-nudges-while-first-deduped-06
  Scenario: a second offending commit nudges even while the first is still deduped
    Given an offending commit sha was nudged as critical on the previous sweep
    And a different offending commit is now reachable from main
    When the babysitter sweep runs again
    Then a nudge is sent naming the second commit

  # BL-631 path-set-read-from-bl632-single-source-07
  Scenario: the QA-exclusive path set comes from BL-632's single source, not a copy
    Given check_pipeline_code_on_main.sh --list-paths reports a path set the sweep has never seen
    When the babysitter sweep runs
    Then a commit touching only a path from that reported set fires a critical finding
    And a commit touching extension/src/ produces no finding

  # BL-631 ancestry-probe-failure-is-unavailable-not-clean-08
  Scenario: an unusable swarmforge-QA ref reports UNAVAILABLE rather than all-clean
    Given the swarmforge-QA ref cannot be resolved
    When the babysitter sweep runs
    Then the sweep reports an UNAVAILABLE finding for the check
    And it does not report the repository as clean

  # BL-631 both-main-refs-are-swept-09
  Scenario Outline: an offending commit is found on either ref that names main
    Given an offending commit is reachable from <ref> and from no other ref naming main
    When the babysitter sweep runs
    Then a critical finding names that commit

    Examples:
      | ref         |
      | main        |
      | origin/main |

  # BL-631 regression-fixture-2026-07-25-10
  Scenario: the 2026-07-25 regression set reproduces exactly
    Given the commit set from the 2026-07-25 BL-590 incident window
    When the babysitter sweep classifies that set
    Then commits 4851901ed, 73706d79e, 8e76f8f10, ebd12542d, e05c025d4, cce634a6c and the merge f8dc07963 are all critical
    And commits b03e17429 and cb85b9e4b produce no finding
