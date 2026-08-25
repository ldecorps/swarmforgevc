# mutation-stamp: sha256=361e7db60f21a02c48fe86c3d094aa22e43c16d98ffebcc98439441a368b7acd
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-14T01:39:13.598580212Z","feature_name":"Models are benchmarked against a SwarmForge role, not against generic coding","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-340-role-benchmark-harness-slice-1.feature","background_hash":"4b45580ff1941927e7671e41adee4332088ef1a36d456bcfd03cf6386d7f55ac","implementation_hash":"unknown","scenarios":[{"index":1,"name":"Every run records quality, latency and cost","scenario_hash":"6885ee1e631ddc06fe9ec11d71e13f36a2fa2a8d39bce20e644cb4c82712596f","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-07-14T01:39:13.598580212Z"}]}
# acceptance-mutation-manifest-end

Feature: Models are benchmarked against a SwarmForge role, not against generic coding

# BL-340: the human's own spec — existing benchmarks measure models as general-purpose
# programmers, but SwarmForge assigns specialised roles with different success criteria, so each
# role may want a different model. He wants best / best value / cheapest-acceptable per role, as
# the evidence base for default swarm configs. This slice proves the harness on ONE role (coder —
# the most objectively measurable) against a few models, end to end, producing a real report.
# Determinism is the real risk: the same task must reach each model from the same starting state,
# or the numbers are noise and every recommendation drawn from them is confidently wrong.

Background:
  Given a fixed role task and a pinned starting state for it

# BL-340 role-benchmark-harness-01
Scenario: The same role task is run against several models from the same starting state
  Given several models are configured for the benchmark
  When the benchmark is run
  Then each model is given the same task
  And each model starts from the same state

# BL-340 role-benchmark-harness-02
Scenario Outline: Every run records quality, latency and cost
  Given several models are configured for the benchmark
  When the benchmark is run
  Then each model's run records its <measurement>

  Examples:
    | measurement       |
    | outcome quality   |
    | time to complete  |
    | tokens used       |
    | cost              |

# BL-340 role-benchmark-harness-03
Scenario: The report ranks the models by best, best value, and cheapest acceptable
  Given several models are configured for the benchmark
  When the benchmark is run
  Then the report names the best model by quality
  And the report names the best model by quality per unit cost
  And the report names the cheapest model that meets the quality threshold

# BL-340 role-benchmark-harness-04
Scenario: The quality threshold for cheapest acceptable is stated, not implied
  When the benchmark is run
  Then the report states the quality threshold a model must meet to be acceptable

# BL-340 role-benchmark-harness-05
Scenario: No model meeting the threshold is reported as such, not silently omitted
  Given no configured model meets the quality threshold
  When the benchmark is run
  Then the report states that no model met the threshold

# BL-340 role-benchmark-harness-06
Scenario: Run-to-run variance is reported, so a difference can be told from noise
  Given a model is run against the same task more than once
  When the benchmark is run
  Then the report states the variance across those runs

# BL-340 role-benchmark-harness-07
Scenario: The report comes from a real run against real models
  When the benchmark is run
  Then the recorded results come from the models actually executing the task

# BL-340 role-benchmark-harness-08
Scenario: A model that cannot really perform the role is not scored as if it had
  Given a configured model cannot carry out the role's actions
  When the benchmark is run
  Then that model is not ranked as though it completed the task

# BL-340 role-benchmark-harness-09
Scenario: The report is committed, so it can be read from repository state alone
  When the benchmark is run
  Then the report is written as a committed artifact in the repository
  And the report can be read back from repository state without the benchmark's live state
