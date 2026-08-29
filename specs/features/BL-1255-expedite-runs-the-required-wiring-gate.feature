# mutation-stamp: sha256=5e9ff7cee1ca84090e0b7b2bbbafdc6671fb78a9cadf04b00b77f8fe663aa273
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-29T08:14:50.045020963Z","feature_name":"BL-1255 an expedited ticket is refused on absent required_wiring, exactly as the live pipeline refuses it","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1255-expedite-runs-the-required-wiring-gate.feature","background_hash":"fe0545cad649b878833c9f2b9342633990afd7f29712f54e7b70aac63e089a21","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a wiring entry that cannot be satisfied refuses the run and names itself","scenario_hash":"20e7a433f5f3548d367c2f0b5d04d7d2e04466daeab0128ba84a8a676de66791","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-29T08:14:50.045020963Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1255 an expedited ticket is refused on absent required_wiring, exactly as the live pipeline refuses it

  The required_wiring gate (pre_qa_gate_lib) is reached from ONE place:
  swarm_handoff.bb, on the documenter's send to QA. The expeditor never sends
  handoff mail - the swarm is stopped, and it drives the role hats directly -
  so an expedited ticket's required_wiring: entries are never checked by
  anything. "Same gates, no machinery" (BL-567) is not true of this gate.

  Evidence, 2026-08-28: BL-1191 was piloted and landed on origin/main
  declaring `swarmforge/scripts/handoffd.bb::wake-dedup-gate`. That literal
  appears nowhere in handoffd.bb - the matcher is a plain substring, so the
  entry could never match - and nothing refused it. The behaviour happened to
  land correctly under a different name, so the miss cost nothing this time;
  what it proves is that a pilot can land a mechanism wired into zero of the
  call sites the ticket was filed to fix (the BL-419 shape) with no refusal
  anywhere in the chain. That is the exact failure the restart gate the
  operator filed on 2026-08-27 exists to catch, and the check that would
  catch it is dark on the pilot path.

  The refusal here is the SAME predicate the live pipeline applies, not a
  second looser one written for the expeditor: an entry that refuses a
  documenter's send must refuse an expedited stage, and an entry that passes
  must pass.

  Background:
    Given an expedite run that has reached the documenter-to-QA boundary
    And the ticket's stage commit is the commit the boundary evaluates

  # BL-1255 expedite-runs-the-required-wiring-gate-01
  Scenario Outline: a wiring entry that cannot be satisfied refuses the run and names itself
    Given the ticket declares one required_wiring entry that is <defect>
    When the expeditor evaluates the documenter-to-QA boundary
    Then the run is refused at that boundary
    And the refusal names the offending entry
    And QA is not stamped

    Examples:
      | defect                                        |
      | a pattern absent from the cited file          |
      | a path absent at the stage commit             |
      | unparseable, carrying no :: separator         |

  # BL-1255 expedite-runs-the-required-wiring-gate-02
  Scenario: every declared entry present lets the run continue
    Given the ticket declares required_wiring entries that are all satisfied at the stage commit
    When the expeditor evaluates the documenter-to-QA boundary
    Then the boundary passes
    And the run continues to the QA stage

  # BL-1255 expedite-runs-the-required-wiring-gate-03
  Scenario: a ticket declaring no wiring is not refused for the absence of the field
    Given the ticket declares no required_wiring entries
    When the expeditor evaluates the documenter-to-QA boundary
    Then the boundary passes
    And the run continues to the QA stage

  # BL-1255 expedite-runs-the-required-wiring-gate-04
  Scenario: a boundary that could not be evaluated is reported as not run, never as passed
    Given the required_wiring evaluation cannot be completed
    When the expeditor evaluates the documenter-to-QA boundary
    Then the run is refused at that boundary
    And the report states the gate did not run
    And the report does not record the boundary as passed
