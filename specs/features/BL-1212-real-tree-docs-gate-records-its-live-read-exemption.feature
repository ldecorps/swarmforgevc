Feature: BL-1212 the real-tree docs gate records why it reads the live repository, and the guard goes green again

  BL-1038's guard refuses a unit-lane test whose cost grows with the repository,
  and it provides for the honest exception: a test that genuinely must observe
  the live tree stays, behind an exemption that records WHY. A bare marker
  fails, deliberately, so the exemption cannot decay into a rubber stamp.

  BL-757 shipped exactly such a test. Its whole purpose is to run the docs
  orphan checker against the real tree - the ticket exists because the checker
  had only ever run against fixtures, and a docs-orphan gate on a synthetic tree
  gates nothing. It is a justified live read. It simply never recorded the
  reason, so the guard has been red since it landed.

  The guard's other complaint is not this ticket's to answer. The pilot mkdtemp
  convention test binds the live root only because the code under test requires
  its own detector through the root it is handed; that is a defect being fixed
  elsewhere, and the right outcome there is a fixture root, never an exemption.
  The guard is green only once both are done.

  Background:
    Given the BL-1038 live-repository derivation guard scanning the extension test tree

  # BL-1212 real-tree-docs-gate-records-its-live-read-exemption-01
  Scenario: the real-tree docs gate declares a reason for reading the live repository
    Given the real-tree docs gate reads the live repository by design
    When the guard inspects it
    Then it is treated as exempt
    And the exemption states why the live read is the assertion

  # BL-1212 real-tree-docs-gate-records-its-live-read-exemption-02
  # RETIRED 2026-09-05 - RETIRE-WITH: BL-1435. "A bare marker with no reason is
  # still refused" was falsified after mint by BL-1317 (533da24a41, 2026-09-02),
  # which re-derived this file's root through git rev-parse --show-toplevel, an
  # idiom the BL-1038 guard does not recognize as a live read at all, so the
  # guard never inspects the marker. BL-1435 widens the guard and carries the
  # bare-marker scenario. Retired, not reworded (BL-1006).

  # BL-1212 real-tree-docs-gate-records-its-live-read-exemption-03
  Scenario: the guard reports no violations across the test tree
    Given every live-repository read in the test tree is either a fixture read or a recorded exemption
    When the guard runs over the whole test tree
    Then it reports no violations
