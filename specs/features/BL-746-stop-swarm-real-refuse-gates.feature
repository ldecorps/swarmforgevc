# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-14T14:53:44.575518Z","feature_name":"The real stop-swarm.sh owns its refuse gates and success line","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-746-stop-swarm-real-refuse-gates.feature","background_hash":"a3671ae931e16d1f281e752421e727aeeb72d996eb2a895615c785d05a0136b6","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: The real stop-swarm.sh owns its refuse gates and success line

  The full-stack stop refuses to report a clean stop while any supervised
  process survives, or when the pipeline kill itself failed. Every scenario
  here executes the real repo-root stop-swarm.sh (a byte-identical runtime
  copy in a fixture root, helpers resolved via its own SCRIPT_DIR seam) and
  asserts on its actual stdout, stderr, and exit status — never on a
  reimplementation of its branching (BL-746).

  Background:
    Given a fixture root holding a runtime copy of the real stop-swarm.sh
    And the fixture's swarmforge/scripts holds the real stack_survivor_scan.sh and stubbed ancillary and pipeline-kill scripts
    And the fixture process table is injected via SWARMFORGE_SURVIVOR_PS_FILE

  # BL-746 stop-swarm-real-refuse-gates-01
  Scenario Outline: a surviving supervised process makes the real stop refuse a clean report
    Given the injected process table shows a running "<survivor argv>"
    And the stubbed pipeline kill exits 0
    When the fixture's stop-swarm.sh runs against the fixture root
    Then its exit status is non-zero
    And its stderr names "<named>" as a survivor
    And its output does not contain "full stack SUCCESS"

    Examples:
      | survivor argv                                               | named       |
      | bash /fixture/.swarmforge/operator/babysitterd.sh /fixture  | babysitterd |
      | claude --remote-control Operator --model x                  | Operator    |

  # BL-746 stop-swarm-real-refuse-gates-02
  Scenario: a clean stop reports the real script's literal success line
    Given the injected process table shows no supervised survivors
    And the stubbed pipeline kill exits 0
    When the fixture's stop-swarm.sh runs against the fixture root
    Then its exit status is 0
    And its stdout contains the line "full stack SUCCESS — no known survivors"

  # BL-746 stop-swarm-real-refuse-gates-03
  Scenario Outline: a failed pipeline kill refuses a clean report even with no survivors
    Given the injected process table shows no supervised survivors
    And the stubbed pipeline kill exits <kill_rc>
    When the fixture's stop-swarm.sh runs against the fixture root
    Then its exit status is <kill_rc>
    And its stderr contains "REFUSE: pipeline stop exited <kill_rc>"
    And its output does not contain "full stack SUCCESS"

    Examples:
      | kill_rc |
      | 7       |
      | 3       |
