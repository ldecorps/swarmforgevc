Feature: The leaderboard ranks models on what survived and what the rework cost

# BL-388 (epic BL-384, slice 4) — THE EPIC'S WIRING SLICE. BL-386 gives the battery a real ceiling
# and BL-387 makes the oracle measure survival and rework. Both can land fully green while the
# leaderboard still ranks on first-pass test counts and the human is none the wiser: pure foundation
# slices with nothing consuming them are dark features. This slice is what makes the epic's thesis
# actually reach the surface the human reads.
#
# Scenario 04 protects slice 1: even with a richer signal, models CAN still tie, and a tie must
# still be reported as a tie rather than resolved into a false winner.

Background:
  Given the benchmark has run its battery through the pipeline

# BL-388 the-ranking-consumes-survival-and-rework-01
Scenario: A model's quality is what survived, not what it first produced
  When the benchmark ranks the models
  Then each model's quality reflects the work that survived the pipeline

# BL-388 the-ranking-consumes-survival-and-rework-02
Scenario: A cheap diff that caused a lot of rework is not cheap
  Given one model's diff was cheap to produce but needed a lot of rework
  And another model's diff cost more to produce but needed none
  When the benchmark ranks the models
  Then the model that needed the rework is charged for it
  And it is not named best value on the strength of its first diff alone

# BL-388 the-ranking-consumes-survival-and-rework-03
Scenario: The leaderboard shows the human the rework-aware answer
  When the human looks at the leaderboard
  Then the leaderboard ranks the models on what survived and what the rework cost

# BL-388 the-ranking-consumes-survival-and-rework-04
Scenario: Models that still cannot be told apart are still reported as a tie
  Given every model survived equally and needed the same rework
  When the benchmark ranks the models
  Then no model is named best by quality
  And the benchmark reports that it could not discriminate between the models
