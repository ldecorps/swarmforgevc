#!/usr/bin/env bash
# BL-913: wiring test for tool_miss_heal_hook.bb - the real PreToolUse hook
# entry point, driven with real stdin JSON exactly as Claude Code would feed
# it, over a real (throwaway) filesystem fixture. Never fakes the hook
# script itself; tool_miss_heal_lib_test_runner.bb already proves the pure
# classify/heal logic and its own end-to-end bash execution, so this file's
# only job is the I/O boundary: does the hook read the right stdin fields,
# honor SWARMFORGE_ROLE_WORKTREE, and emit the right JSON shape.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/../tool_miss_heal_hook.bb"

FAILURES=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }

# ── a non-Bash tool call passes through untouched ──────────────────────────
out="$(echo '{"tool_name":"Read","tool_input":{"file_path":"/x"}}' | bb "$HOOK")"
if [[ "$out" == "{}" ]]; then
  pass "a non-Bash tool call passes through with an empty (no-op) hook response"
else
  fail "a non-Bash tool call passes through untouched (got: $out)"
fi

# ── a Bash call with no pinned worktree known passes through untouched ────
out="$(echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | env -u SWARMFORGE_ROLE_WORKTREE bb "$HOOK")"
if [[ "$out" == "{}" ]]; then
  pass "a Bash call with SWARMFORGE_ROLE_WORKTREE unset passes through untouched (fails open, never blocks)"
else
  fail "a Bash call with no pinned worktree known passes through untouched (got: $out)"
fi

# ── malformed stdin JSON passes through untouched, never crashes ──────────
out="$(echo 'not json at all' | SWARMFORGE_ROLE_WORKTREE=/tmp/whatever bb "$HOOK")"
if [[ "$out" == "{}" ]]; then
  pass "malformed stdin JSON passes through untouched rather than crashing"
else
  fail "malformed stdin JSON passes through untouched (got: $out)"
fi

# ── a Bash call with a known pin rewrites updatedInput.command, and the
#    rewritten command actually heals a real wrong-cwd miss end to end ────
WORKTREE="$(mktemp -d)"
trap 'rm -rf "$WORKTREE"' EXIT
mkdir -p "$WORKTREE/repo"
(cd "$WORKTREE/repo" && git init -q)

HOOK_JSON="$(printf '{"tool_name":"Bash","tool_input":{"command":"cd %s && git status"}}' "$WORKTREE/repo")"
RESPONSE="$(echo "$HOOK_JSON" | SWARMFORGE_ROLE_WORKTREE="$WORKTREE/repo" bb "$HOOK")"

if echo "$RESPONSE" | grep -q '"hookEventName":"PreToolUse"'; then
  pass "a Bash call with a known pin returns a PreToolUse hookSpecificOutput"
else
  fail "expected a PreToolUse hookSpecificOutput, got: $RESPONSE"
fi

REWRITTEN="$(echo "$RESPONSE" | bb -e '(println (get-in (cheshire.core/parse-string (slurp *in*) true) [:hookSpecificOutput :updatedInput :command]))')"

if [[ -n "$REWRITTEN" ]]; then
  pass "the rewritten command is non-empty"
else
  fail "expected a non-empty rewritten command"
fi

# Actually run the rewritten command, from OUTSIDE the pinned worktree (a
# drifted cwd) - a bare `git status` there fails wrong-cwd; the rewritten
# wrapper must heal it from the pinned worktree and succeed.
OUTSIDE="$(mktemp -d)"
ACTUAL_OUT="$(cd "$OUTSIDE" && bash -c "$REWRITTEN")"
ACTUAL_EXIT=$?

if [[ $ACTUAL_EXIT -eq 0 ]]; then
  pass "the rewritten command, run from a drifted cwd, heals to the pinned worktree and succeeds"
else
  fail "expected the rewritten command to succeed after healing, got exit $ACTUAL_EXIT: $ACTUAL_OUT"
fi

if echo "$ACTUAL_OUT" | grep -qi "nothing to commit\|On branch\|No commits yet"; then
  pass "the rewritten command's output is the healed git status, not the original wrong-cwd failure"
else
  fail "expected the healed git status output, got: $ACTUAL_OUT"
fi

if [[ $FAILURES -eq 0 ]]; then
  echo "ALL SCENARIOS PASS"
else
  echo "$FAILURES FAILURE(S)"
  exit 1
fi
