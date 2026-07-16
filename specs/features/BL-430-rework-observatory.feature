# mutation-stamp: sha256=c22ae26348cb6e9be8c21fcf4b437cc3f21f10d958b57bcaf985889f13f24b42
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-15T22:42:49.262270113Z","feature_name":"The swarm can observe its own rework rate","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-430-rework-observatory.feature","background_hash":"af33b97857f4ba80568e43a5cb699356c3097b62bc6af18e5729676adcecf391","implementation_hash":"unknown","scenarios":[{"index":1,"name":"Rework is attributed to the <dimension> it concentrates in","scenario_hash":"602d630271ad188a65f80a67fed627db79a679a672b6f4721479878d3cc9d2ac","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-15T22:42:49.262270113Z"}]}
# acceptance-mutation-manifest-end

Feature: The swarm can observe its own rework rate

# BL-430 (epic BL-429, slice 1 — OBSERVE): the swarm already records per-ticket bounce counts, chaser
# telemetry, and QA bounce evidence, but never composes them into a single "how much is the pipeline
# reworking" signal. This slice adds ONLY that observation layer: a rolling QA-bounce/rework rate over a
# trailing window, attributed per role and per ticket-class, with a trailing baseline, persisted for the
# diagnosis slice (BL-431) and printable by a human. It moves no knob and changes no promotion behaviour.
#
# The behaviour under test is the COMPUTED SIGNAL, not any downstream action — a later slice consumes it.
# Zero-sample safety (scenario 04) and reading evidence from the main ref (scenario 05) are the two traps
# a naive implementation falls into; both are pinned here on purpose.

Background:
  Given a window of completed pipeline work with recorded QA bounces

# BL-430 rework-observatory-01
Scenario: The observatory reports the rework rate over the window
  When the observatory computes the rework signal
  Then it reports the share of tickets that were bounced at least once over the window

# BL-430 rework-observatory-02
Scenario Outline: Rework is attributed to the <dimension> it concentrates in
  Given the bounces in the window concentrate on one <dimension>
  When the observatory computes the rework signal
  Then it names that <dimension> as where rework concentrates

  Examples:
    | dimension    |
    | role         |
    | ticket-class |

# BL-430 rework-observatory-03
Scenario: A trailing baseline is reported alongside the current rate
  When the observatory computes the rework signal
  Then it reports a trailing baseline rate against which the current rate can be compared

# BL-430 rework-observatory-04
Scenario: An empty window reports no sample instead of dividing by zero
  Given a window containing no completed tickets
  When the observatory computes the rework signal
  Then it reports no sample
  And it does not report a rework rate of zero or a rework rate of one hundred percent

# BL-430 rework-observatory-05
Scenario: Bounce evidence is read from the main ref, not a worktree checkout
  Given a QA bounce recorded only as committed evidence on the main ref
  And that evidence file is absent from the current worktree checkout
  When the observatory computes the rework signal
  Then that bounce is counted in the rework rate
