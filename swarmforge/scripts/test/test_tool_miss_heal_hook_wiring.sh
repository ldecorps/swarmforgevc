#!/usr/bin/env bash
# BL-913: wiring test for tool_miss_heal_hook.bb - the real PreToolUse hook
# entry point, driven with real stdin JSON exactly as Claude Code would feed
# it, over a real (throwaway) filesystem fixture. Never fakes the hook
# script itself; tool_miss_heal_lib_test_runner.bb already proves the pure
# classify/heal logic and its own end-to-end bash execution, so this file's
# only job is the I/O boundary: does the hook read the right stdin fields,
# honor SWARMFORGE_ROLE_WORKTREE, and emit the right JSON shape.
set -euo pipefail

# BL-1318: this test exercises parse_config's OTHER behavior (not model
# staffing) - bypass the steward staffing gate so a fixture's placeholder
# --model value ("x", etc.) does not trip an unrelated refusal.
export PACK_STAFFING_SKIP_GATE=1

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
trap 'rm -rf "$WORKTREE" "${OUTSIDE:-}" "${FIXROOT:-}"' EXIT
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

# ── BL-960: an original whose composition cannot parse fail-opens to the
#    byte-untouched original - {} response, no narration on ANY stream. An
#    unterminated heredoc is valid bash on its own (bash treats EOF as the
#    terminator) but swallows the wrapper's own scaffolding when embedded,
#    so the bash -n gate genuinely fires here - a real shape, not a seam. ──
HOOK_STDERR="$(mktemp)"
out="$(echo '{"tool_name":"Bash","tool_input":{"command":"cat <<SFH960\nstill open"}}' | SWARMFORGE_ROLE_WORKTREE=/tmp/whatever bb "$HOOK" 2>"$HOOK_STDERR")"
if [[ "$out" == "{}" && ! -s "$HOOK_STDERR" ]]; then
  pass "BL-960: an unparseable composition fail-opens to the untouched original, silently"
else
  fail "BL-960 fail-open: expected {} and silence, got stdout: $out; stderr: $(cat "$HOOK_STDERR")"
fi
rm -f "$HOOK_STDERR"

# ── BL-960: a hostile-but-valid command (terminated quoted heredoc with a
#    literal close paren) is REWRITTEN, and the rewritten wrapper parses ───
HOSTILE_JSON='{"tool_name":"Bash","tool_input":{"command":"cat <<'"'"'SFH960'"'"'\nline with a ) paren\nSFH960"}}'
HOSTILE_RESPONSE="$(echo "$HOSTILE_JSON" | SWARMFORGE_ROLE_WORKTREE=/tmp/whatever bb "$HOOK")"
HOSTILE_REWRITTEN="$(echo "$HOSTILE_RESPONSE" | bb -e '(println (get-in (cheshire.core/parse-string (slurp *in*) true) [:hookSpecificOutput :updatedInput :command]))')"
if [[ -n "$HOSTILE_REWRITTEN" && "$HOSTILE_REWRITTEN" != "null" ]] && bash -n -c "$HOSTILE_REWRITTEN" 2>/dev/null; then
  pass "BL-960: a heredoc-with-paren command is rewritten and the rewritten wrapper parses as bash"
else
  fail "BL-960: expected a parseable rewritten wrapper for the heredoc command, got: $HOSTILE_RESPONSE"
fi

# ── BL-960: role launch settings register the Bash PreToolUse heal hook
#    again (the operator's re-enable condition is met by this fix). Mirrors
#    test_model_factory_runtime_wiring.sh's source-swarmforge.sh pattern. ──
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"
# A SHORT fixture root: swarmforge.sh derives a unix-socket path from the
# root at source time, and macOS's own $TMPDIR-based mktemp roots overflow
# the 100-char socket-path limit.
FIXROOT="$(mktemp -d /tmp/sfh960.XXXXXX)"
mkdir -p "$FIXROOT/swarmforge/roles" "$FIXROOT/.swarmforge/launch" "$FIXROOT/.swarmforge/prompts"
touch "$FIXROOT/swarmforge/constitution.prompt"
echo "role prompt" > "$FIXROOT/swarmforge/roles/coder.prompt"
cat > "$FIXROOT/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder claude coder --model sonnet
CONF
zsh -c "
  source '$SWARMFORGE_SH' '$FIXROOT'
  parse_config
  write_role_launch_script 1 >/dev/null
" 2>/dev/null || true
SETTINGS_FILE="$FIXROOT/.swarmforge/launch/coder.claude-settings.json"
if [[ -f "$SETTINGS_FILE" ]] \
  && grep -q '"PreToolUse"' "$SETTINGS_FILE" \
  && grep -q '"matcher": "Bash"' "$SETTINGS_FILE" \
  && grep -q 'tool_miss_heal_hook.bb' "$SETTINGS_FILE"; then
  pass "BL-960: generated launch settings register the Bash-matched tool-miss-heal PreToolUse hook again"
else
  fail "BL-960: expected the settings file to register the heal hook, got: $(cat "$SETTINGS_FILE" 2>/dev/null || echo '<missing>')"
fi

if [[ $FAILURES -eq 0 ]]; then
  echo "ALL SCENARIOS PASS"
else
  echo "$FAILURES FAILURE(S)"
  exit 1
fi
