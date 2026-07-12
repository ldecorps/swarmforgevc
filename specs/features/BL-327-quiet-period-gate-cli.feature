Feature: The quiet-period promotion gate is a shell-callable command, not bare Clojure in prose

# BL-327: BL-318 landed promotion-blocked-by-quiet-period? and format-self-generated-source
# in operator_lib.bb, and the coordinator's only way to reach them is prompt prose telling it
# to invoke bare Clojure functions. This codebase's convention is a thin *_cli.bb wrapper over
# a *_lib.bb (coordinator_config_cli.bb, backlog_depth_cli.bb, agent_runtime_cli.bb). Give the
# gate one, so the sole enforcement of a HIGH cost-control gate is a real command with a
# defined contract.

Background:
  Given the coordinator is deciding whether to promote a paused candidate

# BL-327 quiet-period-gate-cli-01
Scenario Outline: The gate blocks only self-generated work during a quiet period
  Given a candidate ticket that <provenance>
  And the swarm <quiet_state>
  When the coordinator asks the gate whether promotion is blocked
  Then the gate answers <answer>

  Examples:
    | provenance             | quiet_state             | answer      |
    | the coordinator raised | is drained and idle     | blocked     |
    | the coordinator raised | still has work in flight | not blocked |
    | a human raised         | is drained and idle     | not blocked |
    | a human raised         | still has work in flight | not blocked |

# BL-327 quiet-period-gate-cli-02
Scenario: A self-generated source line composed by the tool is recognized by the gate
  Given the coordinator composes a self-generated ticket's source line with the tool
  When that ticket is put to the gate during a quiet period
  Then the gate recognizes it as self-generated
  And answers that promotion is blocked

# BL-327 quiet-period-gate-cli-03
Scenario: A hand-written source line does not silently escape the gate
  Given a self-generated ticket whose source line was hand-written rather than composed by the tool
  When that ticket is put to the gate during a quiet period
  Then the gate does not answer that promotion is allowed

# BL-327 quiet-period-gate-cli-04
Scenario: An unreadable candidate fails closed rather than allowing promotion
  Given a candidate ticket that cannot be read or parsed
  When the coordinator asks the gate whether promotion is blocked
  Then the gate reports an error
  And the gate does not answer that promotion is allowed

# BL-327 quiet-period-gate-cli-05
Scenario: The gate is reachable as a shell command
  When the gate is invoked as a shell command with a candidate and the swarm's quiet state
  Then it answers on standard output
  And its exit status distinguishes a blocked candidate from an allowed one
