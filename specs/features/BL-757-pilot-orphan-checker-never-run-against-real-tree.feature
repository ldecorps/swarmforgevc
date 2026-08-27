Feature: real docs tree orphan check is a mechanical land and suite gate

  # BL-757: BL-456's computeDocsStructure orphan checker only ever ran against
  # mkTmpDir fixtures — never this repo's real docs/. Tonight's pilot landed ten
  # unlinked docs (BL-756) with nothing catching them. Specifier rules option 1:
  # gate-blocking (suite + /pilot land), not a checklist reminder — the project's
  # own "index stays exhaustive and orphan-free" rule is already a hard
  # requirement. Known pre-existing orphans use an explicit dated allowlist so
  # the gate stays honest rather than permanently red or silently empty.
  # Companion remaining-work: BL-756 (depends_on).

  Background:
    Given computeDocsStructure can report orphanedDocs for a docs tree root
    And BL-756 has cleared the ten named pilot-batch paths from orphanedDocs

  # BL-757 real-tree-suite-asserts-01
  Scenario: a repo-scoped suite calls computeDocsStructure on the real docs tree
    When the docs-structure real-tree suite runs
    Then it invokes computeDocsStructure against this repository's docs root
    And it does not use only a throwaway fixture tree for that assertion

  # BL-757 non-allowlisted-orphan-fails-02
  Scenario: a non-allowlisted orphan in the real tree fails the suite
    Given the real docs tree has an authored Divio-mode doc not linked from docs/index.md
    And that path is not on the dated known-orphan allowlist
    When the docs-structure real-tree suite runs
    Then the suite fails
    And the failure names the orphaned path

  # BL-757 allowlisted-orphan-passes-03
  Scenario: an allowlisted known orphan does not fail the suite by itself
    Given the real docs tree reports an orphaned path that is on the dated known-orphan allowlist
    And every non-allowlisted authored Divio-mode doc is linked from docs/index.md
    When the docs-structure real-tree suite runs
    Then the suite passes the orphan assertion
    And the allowlist entry carries a date so known debt is not permanent-silent

  # BL-757 pilot-land-new-doc-orphan-refuses-04
  Scenario: /pilot land refuses when a newly touched authored doc is orphaned
    Given the run's commits add or change an authored doc under a Divio mode directory
    And that doc is not linked from docs/index.md
    And the path is not on the known-orphan allowlist
    When the pilot runs the landing gate
    Then the land is refused for an orphaned authored doc
    And the refusal names the path

  # BL-757 pilot-linked-new-doc-passes-05
  Scenario: a newly touched authored doc that is indexed passes the orphan land gate
    Given the run's commits add an authored doc under a Divio mode directory
    And docs/index.md links that path in the matching section
    When the pilot runs the landing gate
    Then the orphan-docs land check completes without refusal for that path
    And other landing gates may still refuse or complete independently

  # BL-757 no-docs-touch-skips-06
  Scenario: commits that do not touch authored docs do not require the orphan land check
    Given the run's commits touched no authored Divio-mode doc under docs/
    When the pilot runs the landing gate
    Then missing orphan-docs evidence does not by itself refuse the land

  # BL-757 refused-orphan-no-durable-07
  Scenario: a refused orphan-docs land writes nothing durable
    Given the run's commits add an authored doc that is orphaned and not allowlisted
    When the pilot runs the landing gate
    Then the land is refused for an orphaned authored doc
    And the ticket yaml stays where it was
    And no acceptance receipt is written
