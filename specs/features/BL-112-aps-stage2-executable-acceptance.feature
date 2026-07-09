Feature: feature files run as generated acceptance tests against the host core

# BL-112 acceptance-pipeline-01
Scenario: a feature file becomes a runnable acceptance test
  Given a parsed feature file in specs/features/
  When acceptance generation runs
  Then generated entry points exist for its scenarios
  And running them exercises the host-side core without booting VS Code

# BL-112 acceptance-pipeline-02
Scenario: a failing behavior fails its acceptance run
  Given a scenario whose Then-condition the core does not satisfy
  When its generated acceptance test runs
  Then the run fails and names the failing scenario

# BL-112 acceptance-pipeline-03
Scenario: generation and runs are sequential
  When the acceptance pipeline executes end to end
  Then generation completes before any acceptance run starts
  And no whole-suite unit run executes concurrently with either

# Non-behavioral gates:
#  - Components live in specs/pipeline/ (generator, runtime, step
#    handlers, runner adapter, convenience scripts).
#  - Step handlers touch no VS Code API and no webview context.
#  - coder.prompt and QA.prompt updated as described.
