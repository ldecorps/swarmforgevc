Feature: GitHub issues that seeded backlog items hear back automatically

# BL-114 issue-loop-01
Scenario: draining a GH item comments and labels the issue
  Given a drained root item with id GH-<n> and a source issue URL
  When the specced helper runs for it
  Then the issue receives a comment with the spec summary and the
    paused item path
  And the issue is labeled swarm-specced

# BL-114 issue-loop-02
Scenario: completion closes the issue with the merge commit
  Given a GH-<n> item that has been merged and moved to done/
  When the completion helper runs for it
  Then the issue receives a comment naming the merge commit
  And the issue is closed

# BL-114 issue-loop-03
Scenario: missing gh auth never blocks the pipeline
  Given gh auth is unavailable
  When either helper runs
  Then it exits zero without touching GitHub
  And the skip is noted in the run log

# Non-behavioral gates:
#  - Tokens come from the host environment only (Secrets rule); never
#    written into the target working directory or any commit.
#  - Helpers testable with an injected/fake gh; no live GitHub in tests.
#  - specifier.prompt (and the closing role's prompt) gain the
#    invocation points.
