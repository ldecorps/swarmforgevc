#!/usr/bin/env bash
# Remote-control (RC) health check: for each configured agent, the live pane
# process must still carry its --remote-control flag, or the agent silently
# drops off claude.ai/code. remote_control_health_lib.bb is the shared
# predicate; remote_control_health.bb is the standalone report/--fix CLI, and
# swarm_ensure.bb folds the same check into `./swarm ensure`.
#
# The classification is a pure function driven by an injected cmdline-probe
# (socket session -> claude argv string or nil), so these scenarios exercise
# it without a real claude process, mirroring test_swarm_ensure.sh's use of
# injected fake probes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../remote_control_health_lib.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── unit: extract-rc-name ────────────────────────────────────────────────────
out="$(bb -e "(load-file \"$LIB\")
  (println (or (remote-control-health/extract-rc-name \"claude --remote-control SwarmForge-Coder -n x\") \"NONE\"))
  (println (or (remote-control-health/extract-rc-name \"claude --remote-control=SwarmForge-QA\") \"NONE\"))
  (println (or (remote-control-health/extract-rc-name \"claude --dangerously-skip-permissions\") \"NONE\"))")"
[[ "$(sed -n 1p <<<"$out")" == "SwarmForge-Coder" ]] || fail "01: space form not extracted (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "SwarmForge-QA" ]]    || fail "01: = form not extracted (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "NONE" ]]             || fail "01: no-flag must be nil (got: $out)"
pass "01: extract-rc-name handles space, = and absent forms"

# ── unit: classify ───────────────────────────────────────────────────────────
out="$(bb -e "(load-file \"$LIB\")
  (println (name (remote-control-health/classify nil nil false)))
  (println (name (remote-control-health/classify \"A\" nil false)))
  (println (name (remote-control-health/classify \"A\" \"A\" true)))
  (println (name (remote-control-health/classify \"A\" nil true)))
  (println (name (remote-control-health/classify \"A\" \"B\" true)))")"
[[ "$(sed -n 1p <<<"$out")" == "off" ]]      || fail "02: nil expected -> :off (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "down" ]]     || fail "02: not alive -> :down (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "healthy" ]]  || fail "02: alive+match -> :healthy (got: $out)"
[[ "$(sed -n 4p <<<"$out")" == "degraded" ]] || fail "02: alive+flag absent -> :degraded (got: $out)"
[[ "$(sed -n 5p <<<"$out")" == "degraded" ]] || fail "02: alive+wrong name -> :degraded (got: $out)"
pass "02: classify separates :down (no process) from :degraded (live, flag lost)"

# ── unit: actionable? only fires on :degraded ────────────────────────────────
out="$(bb -e "(load-file \"$LIB\")
  (doseq [s [:off :down :healthy :degraded]]
    (println s (remote-control-health/actionable? s)))")"
grep -q ':degraded true'  <<<"$out" || fail "03: :degraded must be actionable (got: $out)"
grep -q ':healthy false'  <<<"$out" || fail "03: :healthy must not be actionable (got: $out)"
grep -q ':down false'     <<<"$out" || fail "03: :down deferred to pane check (got: $out)"
grep -q ':off false'      <<<"$out" || fail "03: :off must not be actionable (got: $out)"
pass "03: only :degraded is actionable (never double-respawns a crash or off role)"

# ── integration: check-role with an injected cmdline probe ───────────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/.swarmforge/launch"
printf 'claude --dangerously-skip-permissions --remote-control SwarmForge-Coder --append-system-prompt-file x\n' \
  > "$ROOT/.swarmforge/launch/coder.sh"

# Live process still carries the flag -> :healthy.
status="$(bb -e "(load-file \"$LIB\")
  (println (name (:status (remote-control-health/check-role
    \"$ROOT/.swarmforge\" \"sock\" \"coder\" \"swarmforge-coder\"
    (fn [_ _] \"claude --dangerously-skip-permissions --remote-control SwarmForge-Coder --append-system-prompt-file x\")))))")"
[[ "$status" == "healthy" ]] || fail "04: live flag present -> :healthy (got: $status)"
pass "04: check-role reports :healthy when the live process keeps its flag"

# Live process lost the flag -> :degraded (the repair-worthy case).
status="$(bb -e "(load-file \"$LIB\")
  (println (name (:status (remote-control-health/check-role
    \"$ROOT/.swarmforge\" \"sock\" \"coder\" \"swarmforge-coder\"
    (fn [_ _] \"claude --dangerously-skip-permissions --append-system-prompt-file x\")))))")"
[[ "$status" == "degraded" ]] || fail "05: live process without flag -> :degraded (got: $status)"
pass "05: check-role reports :degraded when a live agent dropped its flag"

# No live process -> :down (deferred to the pane-liveness check).
status="$(bb -e "(load-file \"$LIB\")
  (println (name (:status (remote-control-health/check-role
    \"$ROOT/.swarmforge\" \"sock\" \"coder\" \"swarmforge-coder\" (fn [_ _] nil))))) ")"
[[ "$status" == "down" ]] || fail "06: no process -> :down (got: $status)"
pass "06: check-role reports :down when no agent process is running"

# Launch script with RC disabled -> :off regardless of process state.
printf 'claude --dangerously-skip-permissions --append-system-prompt-file x\n' \
  > "$ROOT/.swarmforge/launch/coder.sh"
status="$(bb -e "(load-file \"$LIB\")
  (println (name (:status (remote-control-health/check-role
    \"$ROOT/.swarmforge\" \"sock\" \"coder\" \"swarmforge-coder\" (fn [_ _] nil))))) ")"
[[ "$status" == "off" ]] || fail "07: launch script without flag -> :off (got: $status)"
pass "07: check-role reports :off when remote_control is disabled for the role"

# ── unit: session-url-in-capture ─────────────────────────────────────────────
out="$(bb -e "(load-file \"$LIB\")
  (println (or (remote-control-health/session-url-in-capture nil) \"NONE\"))
  (println (or (remote-control-health/session-url-in-capture \"\") \"NONE\"))
  (println (or (remote-control-health/session-url-in-capture \"no url here\") \"NONE\"))
  (println (remote-control-health/session-url-in-capture \"blah\nhttps://claude.ai/code/session_abc123\nmore text\"))
  (println (remote-control-health/session-url-in-capture \"https://claude.ai/code/session_old\nsome noise\nhttps://claude.ai/code/session_new\"))")"
[[ "$(sed -n 1p <<<"$out")" == "NONE" ]]                                        || fail "08: nil capture -> nil (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "NONE" ]]                                        || fail "08: empty capture -> nil (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "NONE" ]]                                        || fail "08: no URL present -> nil (got: $out)"
[[ "$(sed -n 4p <<<"$out")" == "https://claude.ai/code/session_abc123" ]]       || fail "08: single URL extracted (got: $out)"
[[ "$(sed -n 5p <<<"$out")" == "https://claude.ai/code/session_new" ]]          || fail "08: multiple URLs -> last (freshest) one wins (got: $out)"
pass "08: session-url-in-capture extracts the freshest session URL from pane text"

# ── unit: wait-outcome ───────────────────────────────────────────────────────
out="$(bb -e "(load-file \"$LIB\")
  (println (name (remote-control-health/wait-outcome false 30)))
  (println (name (remote-control-health/wait-outcome false 0)))
  (println (name (remote-control-health/wait-outcome true 0)))
  (println (name (remote-control-health/wait-outcome true -3)))
  (println (name (remote-control-health/wait-outcome true 30)))")"
[[ "$(sed -n 1p <<<"$out")" == "idle" ]]         || fail "09: not busy -> :idle even with time left (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "idle" ]]         || fail "09: not busy wins over exhausted budget (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "timeout" ]]      || fail "09: still busy at zero remaining -> :timeout (got: $out)"
[[ "$(sed -n 4p <<<"$out")" == "timeout" ]]      || fail "09: still busy past zero (negative remaining) -> :timeout (got: $out)"
[[ "$(sed -n 5p <<<"$out")" == "keep-waiting" ]] || fail "09: still busy with budget left -> :keep-waiting (got: $out)"
pass "09: wait-outcome separates idle/timeout/keep-waiting, idle-now takes priority over an exhausted budget"

echo "ALL PASS"
