#!/usr/bin/env bash
# BL-1004: pure decision table for the sibling-rework claim deferral
# (seat_affinity_lib.bb) - parse knob, claim/defer/cross-seat fork, and the
# invariant-2 no-seat-id diagnostic lines. The generative sweep lives in
# bl1004_seat_affinity_property_runner.bb; the end-to-end wiring through
# the real ready_for_next_task.bb is the BL-1004 acceptance feature.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

bb "$SCRIPT_DIR/seat_affinity_lib_test_runner.bb"
