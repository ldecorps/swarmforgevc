Feature: A test that derives from the live repository reads a pinned fixture or records why it cannot

  extension/test/liveRepoDerivationGuard.test.js (BL-1038) fails on any test
  under extension/test that derives from the live repository without either
  reading a pinned fixture or recording a justification. Three files violate
  it today, so the guard is a standing red in the unit lane.

  The cost of such a test is whatever the repository happens to contain, so it
  grows with the repo and its verdict depends on state the test did not
  establish - the same class the pinned-fixture convention exists to close.

  Background:
    Given the live-repository-derivation scan over extension/test

  # BL-1291 live-repo-derivation-01
  Scenario Outline: Deriving from the live repository requires a pin or a recorded reason
    Given a test that derives from the live repository and <provision>
    When the guard scans it
    Then the test is <verdict> a violation

    Examples:
      | provision                       | verdict         |
      | reads a pinned fixture          | not reported as |
      | records why it cannot be pinned | not reported as |
      | does neither                    | reported as     |

  # BL-1291 live-repo-derivation-02
  Scenario: The guard reports zero violations across extension/test
    Given every test under extension/test
    When the guard scans the tree
    Then it reports no live-repository-derivation violations at all

  # BL-1291 live-repo-derivation-03
  # A recorded exemption is a real outcome, not a loophole: it must name the
  # reason, so a later reader can tell a justified read from an unreviewed one.
  Scenario: A recorded exemption states its reason
    Given a test whose live-repository read is exempted
    When the exemption is read
    Then it names why the read cannot use a pinned fixture
