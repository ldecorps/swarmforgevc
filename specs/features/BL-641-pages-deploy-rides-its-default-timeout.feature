Feature: the Pages deploy has real timeout headroom, and every workflow action is current

  # BL-641: backlog-dashboard.yml's deploy-pages step rides the action's own
  # 10-minute default timeout against a job whose successful runs have taken
  # anywhere from ~30s to ~10m35s for an identical artifact — a marginal,
  # recurring failure, not a regression. Fix gives the deploy step explicit
  # headroom and, repo-wide, bumps four workflow files off deprecated Node-20
  # action majors together rather than piecemeal.

  Background:
    Given .github/workflows/backlog-dashboard.yml

  # BL-641 deploy-timeout-has-headroom-01
  Scenario: the deploy step's timeout has headroom over the worst observed successful run
    When the deploy-pages step's configured timeout is read
    Then it exceeds the worst observed successful run duration of 10m35s

  # BL-641 genuinely-stuck-deploy-still-fails-02
  Scenario: a deploy that genuinely never completes still fails, naming the deploy step
    Given a deploy-pages run that never receives a response from the Pages service
    When the configured timeout elapses
    Then the run fails
    And the failure message names the deploy step

  # BL-641 all-workflow-actions-on-current-majors-03
  Scenario Outline: every workflow file is on a non-deprecated action major
    Given "<workflow file>" in .github/workflows/
    When its action references are read
    Then none of them are pinned to a deprecated Node-20 major

    Examples:
      | workflow file             |
      | backlog-dashboard.yml     |
      | second-swarm-wakeup.yml   |
      | swarm-intake-scan.yml     |
      | swarm-intake.yml          |

  # BL-641 publish-stays-non-blocking-04
  Scenario: the workflow still publishes on a backlog push and still never blocks the push
    Given a push touching backlog/**
    When backlog-dashboard.yml runs and its deploy step fails
    Then the dashboard content is still regenerated on the next push
    And the failing run does not block the push or the pipeline that produced it
