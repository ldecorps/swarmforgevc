Feature: A swarm-compliance battery qualifies a candidate agent model against the tasks every swarm role must perform

  # Purpose: a repeatable exercise to decide whether a candidate model (Grok,
  # Mistral, etc.) is "swarm compliant" — able to act as an agent in this pipeline.
  # Hybrid delivery: the objectively-checkable tasks are scripted pass/fail against
  # the real helper scripts (swarm_handoff.sh, ready_for_next.sh, done_with_current
  # .sh, gherkin_lint_gate.sh) in a throwaway scratch worktree; the judgment-y ones
  # (asks-when-blocked, constitution adherence) are surfaced to a short human rubric.
  # Output is a per-model scorecard with an overall verdict. The battery also runs
  # against the current Claude agents as a known-good reference (self-test) and must
  # not flag them non-compliant. Comprehensive scope: the 8 role-agnostic core tasks
  # plus each role's signature gate. (Operator 2026-07-10.)

  Background:
    Given the compliance battery runs a candidate agent through swarm tasks in a scratch worktree using the real helper scripts

  # BL-231 scripted-pass-01
  Scenario: a correct agent passes every scripted core check
    Given a candidate agent that performs all scripted core tasks correctly
    When the battery runs
    Then every scripted core check is recorded pass on the scorecard

  # BL-231 scripted-fail-02
  Scenario Outline: a non-compliant action fails its scripted check with a reason
    Given a candidate agent that "<violation>"
    When the battery runs
    Then the "<check>" check is recorded fail with the reason on the scorecard

    Examples:
      | violation                                             | check         |
      | writes inbox/new directly instead of swarm_handoff.sh | send-handoff  |
      | commits without the role byline                       | commit-byline |
      | forwards a no-functional-change commit                | no-op-rule    |
      | self-schedules a loop or cron                         | no-scheduling |

  # BL-231 human-rubric-03
  Scenario Outline: judgment competencies are surfaced for human scoring
    Given the "<competency>" competency, which cannot be judged by script
    When the battery runs
    Then it is presented to a human with a rubric and the verdict is recorded on the scorecard

    Examples:
      | competency             |
      | asks-when-blocked      |
      | startup-reread         |
      | constitution-adherence |

  # BL-231 per-role-04
  Scenario Outline: each role's signature gate is checked for the role under test
    Given a candidate agent under test as the "<role>"
    When the battery runs that role's gate
    Then the "<gate>" outcome is recorded on the scorecard

    Examples:
      | role        | gate                                            |
      | specifier   | a lint-clean Gherkin feature file               |
      | coder       | a building, test-passing commit                 |
      | cleaner     | a behavior-preserving refactor, tests still green |
      | architect   | a design-review note naming a real concern      |
      | hardener    | CRAP <= 6 and no surviving mutants on changed code |
      | documenter  | a doc/diagram update matching the change        |
      | QA          | an acceptance run and a correct approve or reject |
      | coordinator | a promotion respecting depth cap and orthogonality |

  # BL-231 scorecard-05
  Scenario: the battery yields a per-model scorecard with an overall verdict
    Given the battery has completed for a candidate model
    When the scorecard is produced
    Then it lists each competency's pass, fail, or human verdict and an overall "swarm compliant" verdict

  # BL-231 reference-06
  Scenario: the battery does not flag the known-good reference agents as non-compliant
    Given the current Claude agent configuration as the reference
    When the scripted battery runs
    Then every scripted check passes

# Non-behavioral gates:
#  - The 8 role-agnostic core competencies are: startup re-read; receive via
#    ready_for_next.sh (in_process first); send a valid handoff; complete via
#    done_with_current.sh (a note is a task); git/worktree discipline (own worktree,
#    role byline, ./tmp, merge_and_process + ancestry before forwarding); the no-op
#    rule; no self-scheduling; asks-when-blocked.
#  - Reuse the real helper scripts for scripted checks; the OPTIONAL live variant
#    can reuse the tracer-bullet harness (trace-hop.js) to flow a bullet through a
#    role. This item's default is the standalone scratch-worktree probe.
#  - DEPENDENCY: actually driving a NON-Claude candidate as an agent requires the
#    provider abstraction (BL-206–209). Until that lands, the battery is validated
#    against Claude agents (reference-06) and defines the "swarm compliant" bar;
#    it is provider-agnostic by design.
#  - Deliverable may be SLICED: slice 1 = the scripted core battery + scorecard
#    (scenarios 01/02/05/06); slice 2 = per-role gates (04); slice 3 = the human
#    rubric wiring (03). Ship slice 1 first.
