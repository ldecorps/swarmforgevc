# mutation-stamp: sha256=cee84b8270308cc810c1b76f1a75ef90c7abdf1bc9a14e348157107fe105e26e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T01:10:42.373332039Z","feature_name":"An unanswered-question escalation whose transport cannot deliver is a visible fault","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1352-escalation-transport-fault-is-visible.feature","background_hash":"0517cc2972d346626d1534adef3dcefb65dde83bce2e33d78470374b396dab9c","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the status surface distinguishes healthy, latent and losing","scenario_hash":"98ec133a663b29f5c7a767dd7b21f245a689f12255185a3dee655aa1551b0ae9","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-09-03T01:10:42.373332039Z"},{"index":2,"name":"the transport line is logged on change, never once per tick","scenario_hash":"19af6de4b07089edd1b1409390a3f180a64af1fa0af11af35069d46b45b14215","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-03T01:10:42.373332039Z"}]}
# acceptance-mutation-manifest-end

Feature: An unanswered-question escalation whose transport cannot deliver is a visible fault

  GH-25 shipped the escalation that tells the human a role question has gone
  unanswered past its threshold. It runs on every operator tick and it is
  wired into the live tick. It has never once delivered, because its ops
  issue number ships commented out in swarmforge.conf and a missing value was
  specced to degrade to a status.json key plus an operator-log warning. No
  surface reads that key, so the degradation is invisible by construction:
  between 2026-08-30T06:36Z and 2026-09-03 the operator log took 7027
  identical refusals while two role slots sat wedged and a backlog-root
  intake stayed blocked for four days.

  This slice does not decide which transport ultimately carries the
  escalation - that is BL-1347's question. It makes an escalation that cannot
  deliver say so on a surface a human already reads, and stops it shouting
  the same line into a log nobody reads.

  Background:
    Given the operator runtime tick is running

  # BL-1352 escalation-transport-fault-01
  Scenario Outline: the status surface distinguishes healthy, latent and losing
    Given the ask escalation transport is <transport>
    And <questions> role question outstanding past the escalation threshold
    When the human reads the swarm status surface
    Then the ask escalation row reads <state>

    Examples:
      | transport    | questions | state             |
      | configured   | one       | ok                |
      | configured   | none      | ok                |
      | unconfigured | none      | warn-unconfigured |
      | unconfigured | one       | fault             |

  # BL-1352 escalation-transport-fault-02
  Scenario: a fault names the role whose question is going undelivered
    Given the ask escalation transport is unconfigured
    And one role question outstanding past the escalation threshold
    When the human reads the swarm status surface
    Then the ask escalation row names the waiting role

  # BL-1352 escalation-transport-fault-03
  Scenario Outline: the transport line is logged on change, never once per tick
    Given the ask escalation transport is unconfigured
    And one role question outstanding past the escalation threshold
    When the operator runtime ticks ten times and the transport <change>
    Then the operator log carries <lines> ask escalation transport lines

    Examples:
      | change             | lines |
      | holds its state    | one   |
      | becomes configured | two   |
