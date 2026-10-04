Feature: BL-1969 ./swarm ensure leaves a GPU-quiet local-model seat down until the pause ends

  The /gpu verb writes .swarmforge/operator/gpu-pause.json and stops every
  seat whose roles.tsv agent is local-model, so the operator can give the
  GPU to another task. Babysitter reads the marker and raises no
  half-launch repair for those seats. ./swarm ensure does not read it: its
  per-role loop recreates every missing session. Babysitter's swarm-starved
  repair runs ./swarm ensure once the swarm has been starved for three
  sweeps, and the control-plane repair, cron freshness and a hand run call
  it too. Any of them during a pause starts qwen and loads the model back
  onto the GPU. QA found this reviewing BL-1950 (c6251ae959).

  Background:
    Given a fixture project whose coder seat is staffed by a local model and whose specifier seat is staffed by claude
    And neither seat has a session

  # BL-1969 ensure-leaves-the-quiet-seat-down-01
  Scenario: during a GPU pause ensure does not recreate the local-model seat
    Given a GPU pause that ends 30 minutes from now
    When ./swarm ensure runs
    Then the coder seat has no session
    And the ensure report names the coder seat as GPU-paused, not as failed

  # BL-1969 ensure-still-recreates-a-claude-seat-02
  Scenario: during a GPU pause ensure still recreates a claude seat on the master checkout
    Given a GPU pause that ends 30 minutes from now
    When ./swarm ensure runs
    Then the specifier seat has a session

  # BL-1969 ensure-recreates-the-seat-after-the-pause-03
  Scenario: once the pause has ended ensure recreates the local-model seat
    Given a GPU pause that ended 1 minute ago
    When ./swarm ensure runs
    Then the coder seat has a session
