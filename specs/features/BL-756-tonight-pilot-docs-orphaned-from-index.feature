Feature: pilot-landed docs are linked from the docs index

  # BL-756: ten pilot-review docs (9 how-to + BL-627 reference) must appear
  # as link targets in docs/index.md — additive-only fix, pre-existing
  # unrelated orphans out of scope.

  # BL-756 pilot-docs-indexed-01
  Scenario: the BL-756 pilot doc targets are not orphaned
    Given the authored docs and the docs index
    When the docs structure is validated
    Then the BL-756 pilot doc targets are not orphaned
