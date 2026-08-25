Feature: The swarm-intake workflow passes GitHub event data into run: only through env:

  # The newly adopted engineering rule bans interpolating ${{ }} expressions
  # inside a run: script body. swarm-intake.yml's "Write backlog root item" step
  # already env-routes the dangerous fields (issue title, body), but its "Commit"
  # step still interpolates ${{ github.event.issue.number }} and
  # ${{ github.event.issue.html_url }} directly in the git commit -m body. Those
  # two values are GitHub-controlled (an integer and a derived URL), so the real
  # injection risk is NEGLIGIBLE — this is defense-in-depth / consistency so the
  # project's own flagship intake workflow obeys its own rule, not an active RCE.

  # BL-227 no-run-interpolation-01
  Scenario: no run: step in swarm-intake.yml interpolates a GitHub event or step-output expression
    Given the swarm-intake workflow
    When its run: script bodies are inspected
    Then none contains a ${{ github.event... }} or ${{ steps... }} expression

  # BL-227 commit-message-preserved-02
  Scenario: the intake commit still records the issue number and issue URL
    Given an issue triggers the intake workflow
    When the Commit step runs
    Then the commit message still records the issue number and the issue URL

# Non-behavioral gates:
#  - The Commit step binds the issue number and html_url to env: keys (as the
#    Write step already does) and references them as quoted "$VAR"s in the git
#    commit -m body.
#  - Behavior unchanged: the produced commit message content is equivalent to
#    today's; only the interpolation mechanism changes.
