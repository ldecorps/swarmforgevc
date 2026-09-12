#!/usr/bin/env bash
# BL-1536: end-to-end coverage for swarm_handoff.bb's terminal non-forwarding
# stamp following the hop's DIRECTION, not the sender's seat alone.
#
# Before this fix, with-non-forwarding stamped `non-forwarding: true` on
# every git_handoff whose SENDER was the last code-worktree role (QA on the
# live table), whatever the RECIPIENT. QA's terminal FORWARD to the
# coordinator (nobody forwards that again) is meant to carry the marker;
# QA's BOUNCE to an earlier role got the same marker by accident, and
# Article 2.4 then told the recipient a marked inbound is merge-only: merge,
# done_with_current, send nothing - dropping the bounce (seven times since
# 2026-09-02, per backlog/evidence/BL-1536-specifier-stamped-qa-bounce-census-20260911.md).
#
# This drives the REAL swarm_handoff.bb send path end to end (not a
# reimplementation of the direction math - that is
# reverse_audit_handoff_test_runner.bb's job) and asserts the installed
# parcel's own `non-forwarding:` header, both directions, from the same
# terminal sender.

set -euo pipefail
unset SWARMFORGE_ROLE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m seed
# BL-1390: fixture root proven under mkdtemp before any mutating git command -
# a linked worktree or a cwd mistake shares the LIVE .git, and this repo is
# a fresh `git init` at ROOT, so its common-dir must resolve back under ROOT.
COMMON_DIR="$(git -C "$ROOT" rev-parse --git-common-dir)"
case "$COMMON_DIR" in
  /*) [[ "$COMMON_DIR" == "$ROOT"/* ]] || fail "fixture git-common-dir escaped ROOT: $COMMON_DIR" ;;
  *) : ;;
esac
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

# roles.tsv whose last code-worktree row is QA - the live pack shape.
mkdir -p "$ROOT/.swarmforge"
{
  printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$ROOT"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ROOT"
  printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$ROOT"
  printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$ROOT"
  printf 'QA\tQA\t%s\tswarmforge-QA\tQA\tclaude\ttask\tforward-only\n' "$ROOT"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT"
} > "$ROOT/.swarmforge/roles.tsv"

# BL-1530: git_handoff speaks the two-call self-audit (Article 2.3, BL-1306) -
# the first invocation challenges and queues nothing (HANDOFF_NOT_QUEUED by
# design), the identical second call installs the parcel. SKIP_SYNC_INJECT
# keeps the send mailbox-only (no tmux socket in this fixture) while still
# printing the installed file's path, exactly as swarm_handoff.bb's own
# "HANDOFF QUEUED (mailbox only, no tmux inject):<path>" line does.
send() {
  local recipient="$1" task="$2"
  local draft="$ROOT/draft_${task}.txt"
  printf 'type: git_handoff\nto: %s\npriority: 00\ntask: %s\ncommit: %s\n' \
    "$recipient" "$task" "$COMMIT" > "$draft"
  local first
  first="$(cd "$ROOT" && SWARMFORGE_ROLE=QA SWARMFORGE_SKIP_SYNC_INJECT=1 bb "$SWARM_HANDOFF" "$draft" 2>&1)" || true
  grep -q "^HANDOFF_NOT_QUEUED$" <<< "$first" \
    || fail "task=$task: first call did not print HANDOFF_NOT_QUEUED; got: $first"
  local out
  out="$(cd "$ROOT" && SWARMFORGE_ROLE=QA SWARMFORGE_SKIP_SYNC_INJECT=1 bb "$SWARM_HANDOFF" "$draft")"
  local outfile
  outfile="$(echo "$out" | sed -n 's/^.*:\(\/[^[:space:]]*\.handoff\)$/\1/p' | tail -1)"
  [ -n "$outfile" ] || fail "task=$task: no installed handoff file reported: $out"
  [ -f "$outfile" ] || fail "task=$task: reported file does not exist: $outfile"
  echo "$outfile"
}

# ── 01: QA bouncing to an EARLIER role (hardender) is never stamped ────────
BOUNCE_FILE="$(send hardender bl1536-test-qa-bounce-to-hardender)"
grep -q '^to: hardender$' "$BOUNCE_FILE" \
  || fail "bounce parcel: expected 'to: hardender', file:\n$(cat "$BOUNCE_FILE")"
if grep -q '^non-forwarding:' "$BOUNCE_FILE"; then
  fail "QA->hardender bounce was stamped non-forwarding - Article 2.4 would tell hardender to merge-only and drop it:\n$(cat "$BOUNCE_FILE")"
fi
pass "QA's bounce to hardender carries no non-forwarding marker"

# ── 02: QA's terminal FORWARD to the coordinator still carries the marker ──
FORWARD_FILE="$(send coordinator bl1536-test-qa-forward-to-coordinator)"
grep -q '^to: coordinator$' "$FORWARD_FILE" \
  || fail "forward parcel: expected 'to: coordinator', file:\n$(cat "$FORWARD_FILE")"
grep -q '^non-forwarding: true$' "$FORWARD_FILE" \
  || fail "QA->coordinator terminal forward lost its non-forwarding marker:\n$(cat "$FORWARD_FILE")"
pass "QA's terminal forward to the coordinator still carries non-forwarding: true"

echo "ALL PASS"
