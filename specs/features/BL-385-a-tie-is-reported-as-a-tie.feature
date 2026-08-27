Feature: The benchmark reports a tie as a tie, never as a winner

# BL-385 (epic BL-384, slice 1): the committed run has haiku, sonnet and opus ALL at meanQuality 1.0
# with a stdDev of 0 — a perfect three-way tie. `maxBy` (extension/src/benchmark/rank.ts:8) reduces
# with a strict `>`, so a tie silently keeps the FIRST array element, and the leaderboard now tells
# the human "Best coder: Claude Haiku" on the strength of the config array's ordering. The benchmark
# failing to discriminate IS the honest result; it must be reported as such.
#
# Scenario 02 is the neighbour guard: the fix must not swallow a GENUINE winner. Scenario 05 is the
# array-order pin — the reported result must not depend on how the models happen to be listed, which
# is the actual bug and the one a mutant would most easily restore.

Background:
  Given the benchmark has scored every model

# BL-385 a-tie-is-reported-as-a-tie-01
Scenario: Models that all score the same are reported as a tie
  Given every model reached the same quality
  When the benchmark ranks the models
  Then no model is named best by quality
  And the benchmark reports that it could not discriminate between the models

# BL-385 a-tie-is-reported-as-a-tie-02
Scenario: A model that genuinely scores higher is still named
  Given one model reached a higher quality than every other
  When the benchmark ranks the models
  Then that model is named best by quality
  And the benchmark does not report that it could not discriminate between the models

# BL-385 a-tie-is-reported-as-a-tie-03
Scenario: When quality cannot discriminate, best value is reported as a ranking on cost alone
  Given every model reached the same quality
  When the benchmark ranks the models
  Then the best-value answer is reported as a ranking on cost alone

# BL-385 a-tie-is-reported-as-a-tie-04
Scenario: The leaderboard says the benchmark could not discriminate
  Given every model reached the same quality
  When the human looks at the leaderboard
  Then the leaderboard reports that the benchmark could not discriminate
  And the leaderboard names no best model

# BL-385 a-tie-is-reported-as-a-tie-05
Scenario: The reported result does not depend on the order the models were listed in
  Given every model reached the same quality
  When the benchmark ranks the models in one order
  And the benchmark ranks the same models in a different order
  Then both rankings report the same result
