# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T07:45:58.817335824Z","feature_name":"The unit suite runs below the 10-second target and an over-budget run is surfaced","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-445-unit-suite-below-10s.feature","background_hash":"9dbd23ebca795055bc906906bc3085e00f82a8d06f258a7c7fb096bfd853769c","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: The unit suite runs below the 10-second target and an over-budget run is surfaced

# BL-445 (feature, operator "next absolute priority" 2026-07-16): the recorded whole-suite
# wall-clock (extension/.test-durations.jsonl duration_ms) is 10.3-13.0s across recent passing
# runs, over the operator's 10s target. A slow suite gets skipped, and suite speed is a
# correctness property, not a nicety (engineering.prompt Test Speed And Isolation).
#
# TWO things must hold and they are verified DIFFERENTLY:
#   1. OPERATIONAL (QA e2e, not a Gherkin scenario): the suite is ACTUALLY under 10s - run
#      `npm test` in extension/ and confirm the recorded duration_ms is < 10000 with headroom.
#   2. DURABLE RATCHET (the scenarios below): a whole-suite budget verdict classifies a recorded
#      run against the 10s target and SURFACES an over-budget run, so a future regression can
#      never creep back silently the way BL-078/BL-252's soft trend let it (that trend tells you
#      the suite got slower, never draws a hard line at the target).
#
# PROFILE BEFORE CUTTING (specifier constraint). A per-FILE 7s hard budget already exists and is
# enforced after every run (extension/src/tools/check-suite-file-budget.ts,
# PER_FILE_DURATION_BUDGET_MS = 7000, wired through extension/scripts/recordTestDuration.js). With
# the slowest file ~4.8s, isolated wall (~slowest-file + 1s across the parallel worker pool) is
# ~6s - yet the recorded whole-suite number is 10-13s and jitters. So the excess is NOT one
# obvious pole the per-file guard would already catch; profile to locate the real cost (fixed
# overhead such as coverage instrumentation / worker-pool spin-up, a residual sub-7s pole, or
# machine-load contention from concurrent worktree runs) BEFORE changing anything. Never hit the
# number by deleting tests or dropping coverage: the passing test_count must not fall and coverage
# must not regress. No real timers (already banned) - if a real-clock wait is the cost, remove it.
#
# Scope (verify at build time): the recorder/measurement path
# (extension/scripts/recordTestDuration.js + extension/.test-durations.jsonl), the existing budget
# guard family (extension/src/tools/check-suite-file-budget.ts and its swarm-metrics helpers) to
# extend to a whole-suite verdict, and whichever profiled poles/overhead the reduction actually
# touches. Whether the whole-suite verdict HARD-FAILS the run or only warns is an architect call:
# prefer surfacing over a hard fail at the boundary, since the recorded number jitters under swarm
# load and a hard 10000ms fail would flake - the per-file 7s guard stays the hard gate.

Background:
  Given a passing unit-suite run recorded in the test-duration log

# BL-445 unit-suite-below-10s-01
Scenario Outline: a recorded suite run is classified against the 10-second budget
  Given the recorded run lasted "<duration_ms>" ms
  When its duration is checked against the 10-second suite budget
  Then the run is reported "<verdict>"

  Examples:
    | duration_ms | verdict       |
    | 6000        | within-budget |
    | 9999        | within-budget |
    | 10000       | over-budget   |
    | 12963       | over-budget   |

# BL-445 unit-suite-below-10s-02
Scenario: an over-budget suite run is surfaced with its measured duration, not silently accepted
  Given the recorded run is over the 10-second suite budget
  When the whole-suite budget verdict is produced
  Then the verdict names the run as an offender with its measured duration
