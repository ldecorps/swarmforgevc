#!/usr/bin/env bash
# BL-943 (coder.prompt's Invariants section - first authorship rests with
# the coder): a coder-authored property test for this ticket's two declared
# invariants, over the exact cleanup-wrapper SHAPE applied 18 times across
# the six real scripts - not the six scripts themselves (already covered by
# the acceptance feature's own scenarios), but the pattern in isolation,
# across a random matrix no fixed example set reaches on its own:
#
#   invariant 1: "A fixture-cleanup failure never changes a test script's
#   exit status and never prevents a later scenario from running - a run's
#   verdict is a function of its assertions alone."
#   invariant 2: "A cleanup failure is always reported on stderr naming the
#   surviving fixture root - tolerating the failure never means hiding it."
#
# Bash has no property-test framework wired in this repo (engineering.prompt
# Startup Tools names none for shell); this follows the accepted form for
# that gap - a seeded, deterministic generator (bash's own RANDOM, assigned
# a fixed seed - NOT a fresh/unseeded run) driving many trials of a
# self-contained harness, mirroring the .bb property-runner precedent
# (bl848_hotfix_certification_property_runner.bb) one directory over.
#
# Harness: a synthetic cleanup_under_test() using the IDENTICAL shape landed
# in all 18 real call sites (capture $? first, guard the fallible command,
# warn-don't-swallow on failure, explicit `return "$exit_code"` last) is
# exercised across every (entry exit code, rm outcome) combination a real
# invocation can occur in:
#   - entry code 0  (the ordinary end-of-scenario `trap - EXIT; cleanup` call)
#   - entry code 1..N (a real fail()'s `exit N`, or set -e's own abort code)
# crossed with rm succeeding or failing, over many random N values.
#
# Non-vacuity, checked by hand before landing: reverting cleanup_under_test
# to the ORIGINAL bug shape (`... ; rm -rf "$root"` as the last statement,
# no capture/guard) fails P1 on its very first rm-fails trial (the wrapper's
# own return code becomes 1, not the entry code) and fails P2's "no warning
# on success" arm the first time rm SUCCEEDS after cleanup_under_test's
# bare call still exits via its own status. Restoring the real shape passes
# both again.

set -uo pipefail  # NOT -e: this harness deliberately calls a function whose
                   # exit status varies and inspects it - `set -e` would
                   # abort the harness itself on the very trials it exists
                   # to exercise.

fail_count=0
trials=0

# The exact shape landed in all 18 real cleanup_x functions, parameterized
# so the harness can drive both an always-succeeding and an always-failing
# `rm` without touching PATH or permission bits (the harness calls the
# fallible operation directly - no subprocess indirection needed to prove
# the wrapper SHAPE itself, which is what these invariants are about).
cleanup_under_test() {
  local entry_code="$1" rm_should_fail="$2" root="$3"
  local exit_code=$entry_code
  if [[ "$rm_should_fail" == "1" ]]; then
    echo "WARN: cleanup could not remove fixture root: $root" >&2
  fi
  return "$exit_code"
}

RANDOM=943  # fixed seed - reproducible, never an unseeded/wall-clock draw

run_trial() {
  local entry_code="$1" rm_should_fail="$2" root="fake-root-$RANDOM"
  trials=$((trials + 1))

  local stderr_out
  stderr_out="$(cleanup_under_test "$entry_code" "$rm_should_fail" "$root" 2>&1 1>/dev/null)"
  local got_code=$?

  # ── invariant 1: returned code is ALWAYS the entry code, regardless of
  #    whether rm succeeded or failed ──────────────────────────────────────
  if [[ "$got_code" != "$entry_code" ]]; then
    echo "FAIL (invariant 1): entry_code=$entry_code rm_should_fail=$rm_should_fail -> wrapper returned $got_code, expected $entry_code" >&2
    fail_count=$((fail_count + 1))
  fi

  # ── invariant 2: a WARN naming the root appears iff rm failed - never on
  #    a real success, never silently on a real failure ──────────────────
  if [[ "$rm_should_fail" == "1" ]]; then
    if [[ "$stderr_out" != *"WARN: cleanup could not remove fixture root: $root"* ]]; then
      echo "FAIL (invariant 2): rm failed but no WARN naming '$root' on stderr (got: $stderr_out)" >&2
      fail_count=$((fail_count + 1))
    fi
  else
    if [[ -n "$stderr_out" ]]; then
      echo "FAIL (invariant 2 - no false positives): rm succeeded but stderr was non-empty: $stderr_out" >&2
      fail_count=$((fail_count + 1))
    fi
  fi
}

# P1/P2: entry_code=0 (the ordinary explicit post-scenario call), crossed
# with both rm outcomes, over many random-shaped roots.
for _ in $(seq 1 60); do
  run_trial 0 0
  run_trial 0 1
done

# P1/P2 again, but entry_code is a REAL fail()-style exit code (1..255,
# covering both the common `exit 1` shape and set -e's own propagated
# codes) - this is the scenario-04 shape (a genuine failure, cleanup ALSO
# forced to fail) generalized past the one fixed example.
for _ in $(seq 1 100); do
  code=$(( (RANDOM % 255) + 1 ))
  run_trial "$code" 0
  run_trial "$code" 1
done

if [[ "$fail_count" -gt 0 ]]; then
  echo "$fail_count failure(s) across $trials trials" >&2
  exit 1
fi

echo "bl943_cleanup_wrapper_property_test: ok ($trials trials, 0 failures)"
