# mutation-stamp: sha256=0e493d7e90e8488cb279f706513af5ff2659df445628b41b3a513903ff0daaf8
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T11:55:17.178766319Z","feature_name":"Model Steward is a coordinator-assignable role with generated compatibility docs","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-557-model-steward-slice3-role-and-compat-docs.feature","background_hash":"785d6c36ead5d4f22a777264a70d85d626c5ce2aed43cfb06059c6ed89c275af","implementation_hash":"unknown","scenarios":[{"index":4,"name":"compatibility documentation reflects the current registry status","scenario_hash":"9dc86faeb02dedf7f89c851ffa984d26459323d50e2b5607950e28cf773d0b93","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-24T11:55:17.178766319Z"}]}
# acceptance-mutation-manifest-end

Feature: Model Steward is a coordinator-assignable role with generated compatibility docs

  # BL-557 (BL-547 Slice 3, drained from
  # BL-547-model-steward-slices-2-3.feature.draft 2026-07-22): Slice 1 shipped
  # swarmforge/roles/model-steward.prompt as a stub explicitly not wired as a
  # live role. Slice 3 graduates it to a real infrastructure role the coordinator
  # MAY assign discrete tasks to, and adds a `model-steward compat-docs` command
  # that projects the registry into operator-facing compatibility documentation.
  #
  # PIN (human ruling 2026-07-22): NO always-on pane, mailbox, worktree, standing
  # loop, or scheduled re-benchmark. The steward emits knowledge/certification
  # updates on demand; it never mutates production routing directly. See BL-557
  # ticket approval_context.

  Background:
    Given the Model Steward registry is initialised
    And the Model Registry contains certified and candidate models

  # BL-557 steward-role-is-coordinator-assignable-01
  Scenario: the Model Steward role prompt exists as a coordinator-assignable infrastructure role
    When the swarm infrastructure role prompts are read
    Then a model-steward role prompt exists under swarmforge/roles/
    And it states the coordinator may assign steward tasks
    And it states the steward emits certification updates without mutating production routing directly

  # BL-557 steward-adds-no-standing-pane-02
  Scenario: graduating the role adds no always-on pane to any launch path
    When the swarm launch and teardown paths are inspected
    Then no always-on model-steward session is added
    And the steward has no mailbox, worktree, or standing loop

  # BL-557 compat-docs-lists-status-and-limitations-03
  Scenario: compatibility documentation lists each model's certification status and limitations
    When model-steward compat-docs is generated
    Then the document lists each registered model with its certification status
    And the document lists each model's known limitations

  # BL-557 compat-docs-links-role-matrix-04
  Scenario: compatibility documentation links to the role recommendation matrix
    When model-steward compat-docs is generated
    Then the document links to the role recommendation matrix

  # BL-557 compat-docs-regenerates-from-registry-05
  Scenario Outline: compatibility documentation reflects the current registry status
    Given model "<model>" has registry status "<status>"
    When model-steward compat-docs is generated
    Then the document shows model "<model>" with status "<status>"

    Examples:
      | model           | status     |
      | claude-sonnet-5 | certified  |
      | llama-3.3-70b   | candidate  |
      | old-model       | deprecated |
