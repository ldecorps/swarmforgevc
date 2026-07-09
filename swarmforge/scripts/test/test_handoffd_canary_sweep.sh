#!/usr/bin/env bash
# BL-121: handoffd's canary-sweep! completes a pending synthetic canary by
# moving it from canary-queue/pending/ into canary-queue/completed/ as part
# of the daemon's own poll loop - never through any role's real inbox
# (canary-isolation-04). Uses --poll-once (a single synchronous invocation,
# no background process, no sleep loop) for a fast, deterministic run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge/daemon"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"
mkdir -p "$ROOT/.swarmforge/handoffs/outbox"

PENDING_DIR="$ROOT/.swarmforge/daemon/canary-queue/pending"
COMPLETED_DIR="$ROOT/.swarmforge/daemon/canary-queue/completed"
mkdir -p "$PENDING_DIR"

# ── 01: a pending canary moves to completed/ after one poll cycle ──────────
TASK="canary-20260709T120000Z"
printf 'task: %s\nsent_at: 2026-07-09T12:00:00Z\n' "$TASK" > "$PENDING_DIR/$TASK.handoff"

bb "$HANDOFFD" "$ROOT" --poll-once

[[ -f "$PENDING_DIR/$TASK.handoff" ]] && fail "01: canary should be removed from pending/ once swept"
[[ -f "$COMPLETED_DIR/$TASK.handoff" ]] || fail "01: expected canary to land in completed/"
grep -q "task: $TASK" "$COMPLETED_DIR/$TASK.handoff" || fail "01: completed file must keep its task header"
grep -q "canary-completed" "$ROOT/.swarmforge/daemon/handoffd.log" || fail "01: expected a canary-completed log line"
pass "01: pending canary is completed by the daemon's own poll loop"

# ── 02: sweeping is a no-op (no crash) when no canary is pending ───────────
rm -rf "$PENDING_DIR"
bb "$HANDOFFD" "$ROOT" --poll-once
pass "02: sweep tolerates a missing pending/ directory"

# ── 03: never lands in any role's real handoff inbox ───────────────────────
[[ -d "$ROOT/.swarmforge/handoffs/inbox" ]] && fail "03: canary must never appear under handoffs/inbox"
pass "03: canary queue stays isolated from real pipeline inboxes"

echo "ALL PASS"
