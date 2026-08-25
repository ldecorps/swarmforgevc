Feature: BL-533 claimed deliverables are tracked and wired before close
  Specs and modules must not be reported ready while untracked or
  unwired. This ticket arms mechanical exit gates for (1) acceptance
  feature files being committed, and (2) multi-slice epics having an
  explicit runtime-wiring declaration before close.

  Hooks (named, not optional):
  - Spec-ready / mint hygiene: specifier_backlog_hygiene_gate.sh fails
    when acceptance: points at a working-tree path that is not in
    git ls-files.
  - Documenter to QA: swarm_handoff pre-QA acceptance checks refuse when
    the acceptance path is missing from the cited commit tree.
  - Epic close / last-child promotion: backlog epic hygiene refuses when
    an epic has two or more decomposes_into children and none of those
    children declare a non-empty required_wiring list (the explicit
    runtime-wiring ticket rule from the BL-512 audit).

  # BL-533 acceptance-tracking-01
  Scenario Outline: hygiene commit-tracking check for an acceptance feature path
    Given a paused ticket whose acceptance line points at a feature path that is <tracking>
    When specifier_backlog_hygiene_gate runs on that ticket
    Then the commit-tracking result for that acceptance path is <result>

    Examples:
      | tracking                         | result                                      |
      | present on disk but not ls-files | fail naming the untracked acceptance path   |
      | tracked by git ls-files          | pass                                        |

  # BL-533 epic-wiring-checklist-02
  Scenario Outline: multi-slice epic wiring exit checklist
    Given an epic tracker with at least two decomposes_into children
    And <wiring_state>
    When the epic wiring exit checklist runs
    Then the checklist <outcome>

    Examples:
      | wiring_state                                                    | outcome                                                         |
      | none of those children declare a non-empty required_wiring list | fails saying a runtime-wiring declaration is missing            |
      | at least one child declares a non-empty required_wiring list    | passes                                                          |
