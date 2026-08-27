Feature: A model is scored on the diff that survives the pipeline, not on its first diff

# BL-387 (epic BL-384, slice 3): the harness executes the provider CLI once against a fresh fixture
# and scores the resulting diff immediately — nothing routes it through cleaner -> architect ->
# hardener -> QA. So it is structurally blind to rework. The human's framing is the epic's thesis:
# "a coder's value isn't its first diff, it's the diff that survives cleaner -> architect ->
# hardener -> QA. First-pass benchmarks can't see rework." With a ~58% bounce rate already noted on
# BL-338, rework is plausibly where the real cost difference between models actually lives.
#
# This slice makes the oracle deep. Feeding what it measures into the SCORE and the leaderboard is
# BL-388 — until that lands, this signal is recorded but nothing ranks on it.

Background:
  Given a model has produced a diff for a benchmark task

# BL-387 the-oracle-scores-what-survives-the-pipeline-01
Scenario: The diff is put through the pipeline rather than scored where it lands
  When the benchmark judges the diff
  Then the diff is put through the pipeline's review stages

# BL-387 the-oracle-scores-what-survives-the-pipeline-02
Scenario: What survives the pipeline is what counts
  Given the pipeline changed the diff before accepting it
  When the benchmark judges the diff
  Then the model is scored on what the pipeline accepted
  And the model is not scored on the diff it first produced

# BL-387 the-oracle-scores-what-survives-the-pipeline-03
Scenario Outline: Every bounce is counted as rework
  Given the pipeline bounced the diff <bounces> times before accepting it
  When the benchmark judges the diff
  Then the trial records <bounces> rounds of rework

  Examples:
    | bounces |
    | 0       |
    | 1       |
    | 3       |

# BL-387 the-oracle-scores-what-survives-the-pipeline-04
Scenario: A diff the pipeline never accepts is recorded as not surviving
  Given the pipeline never accepted the diff
  When the benchmark judges the diff
  Then the trial records that the diff did not survive
  And the model is not credited with having solved the task
