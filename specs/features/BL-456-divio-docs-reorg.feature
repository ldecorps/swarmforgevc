# mutation-stamp: sha256=d584c000474dd864e76954fd4b3ce5bbd4d4ba5ee7f426b5cca37e7c1538052b
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T16:22:47.976203259Z","feature_name":"The project docs are organized into the Divio four modes with a classified index","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-456-divio-docs-reorg.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"Each Divio mode is classified with its reader orientation in the index","scenario_hash":"b962bc83938cfda58d3d4898a1657ffe137acedbc60c85450aff0729748d62b0","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-07-16T16:19:47.036197369Z"}]}
# acceptance-mutation-manifest-end

Feature: The project docs are organized into the Divio four modes with a classified index

  # BL-456 (docs, human-requested via Telegram SUP-7, relayed by the Operator 2026-07-16): organize the
  # project documentation by the Divio Documentation System's four modes, each serving a distinct reader
  # need — TUTORIALS (learning-oriented), HOW-TO guides (task-oriented), REFERENCE (information-oriented),
  # EXPLANATION (understanding-oriented). Today docs/ is flat with no index and no mode separation. Scope
  # fork settled with the human via AskUserQuestion: FULL migration + REWRITE — reorganize AND rewrite the
  # existing authored docs so each fits its target mode — plus a top-level docs/index.md that names the four
  # modes, states each mode's orientation, and links every authored doc so none is orphaned.
  #
  # The machine-checkable acceptance below is the STRUCTURAL contract (the four mode dirs exist, the index
  # classifies and links every authored doc, each mode has content), driven by a small host-side docs-
  # structure validator (the pattern docs-tree-schema.md / the docs-tree generator already establishes,
  # resolving docs/ via the repo top-level). The prose QUALITY of each rewritten doc — does a tutorial teach,
  # is a how-to a task recipe, is reference exhaustive, does an explanation give rationale — is the
  # documenter's + the human's qualitative review (the E2E QA procedure), not asserted here. The outline
  # step handler validates each mode value against an explicit KNOWN_VALUES lookup (engineering load-bearing-
  # column rule).

  # BL-456 divio-docs-01
  Scenario: The four Divio mode directories exist under docs
    Given the project docs tree
    When the docs structure is validated
    Then a directory exists for each of the tutorials, how-to, reference, and explanation modes

  # BL-456 divio-docs-02
  Scenario Outline: Each Divio mode is classified with its reader orientation in the index
    Given the docs index
    When the docs structure is validated
    Then the "<mode>" mode is listed with the "<orientation>" orientation

    Examples:
      | mode        | orientation   |
      | tutorials   | learning      |
      | how-to      | task          |
      | reference   | information   |
      | explanation | understanding |

  # BL-456 divio-docs-03
  Scenario: Each Divio mode directory contains at least one document
    Given the four Divio mode directories
    When the docs structure is validated
    Then each mode directory contains at least one document

  # BL-456 divio-docs-04
  Scenario: Every authored doc is reachable from the docs index
    Given the authored docs and the docs index
    When the docs structure is validated
    Then every authored doc is linked from the index
    And no authored doc is orphaned
