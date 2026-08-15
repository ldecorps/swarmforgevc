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

# ── BL-898: session-dead (flag present, cloud session dead) ─────────────────

# ── unit: footer-status reads only the LAST captured line, never scrollback ──
out="$(bb -e "(load-file \"$LIB\")
  (println (name (remote-control-health/footer-status \"some scrollback\nbypass permissions on (shift+tab to cycle)  /rc\")))
  (println (name (remote-control-health/footer-status \"some scrollback\n/rc failed\")))
  (println (name (remote-control-health/footer-status \"/rc failed\nbypass permissions on (shift+tab to cycle)  /rc\")))
  (println (name (remote-control-health/footer-status \"no rc chrome on this pane at all\")))
  (println (name (remote-control-health/footer-status nil)))
  (println (name (remote-control-health/footer-status \"\")))")"
[[ "$(sed -n 1p <<<"$out")" == "healthy" ]] || fail "10: a bare /rc on the footer line -> :healthy (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "failed" ]]  || fail "10: /rc failed on the footer line -> :failed (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "healthy" ]] || fail "10: a stale '/rc failed' earlier in scrollback must not win over a healthy CURRENT footer (got: $out)"
[[ "$(sed -n 4p <<<"$out")" == "unknown" ]] || fail "10: no rc chrome on the footer line -> :unknown (got: $out)"
[[ "$(sed -n 5p <<<"$out")" == "unknown" ]] || fail "10: nil capture -> :unknown (got: $out)"
[[ "$(sed -n 6p <<<"$out")" == "unknown" ]] || fail "10: empty capture -> :unknown (got: $out)"
pass "10: footer-status reads only the rendered footer line, never a stale match higher up in scrollback"

# ── unit: advance-footer-streak! persists consecutive-failure count ─────────
out="$(bb -e "(load-file \"$LIB\")
  (println (remote-control-health/read-footer-streak \"$ROOT/.swarmforge\" \"coder\"))
  (println (remote-control-health/advance-footer-streak! \"$ROOT/.swarmforge\" \"coder\" :failed))
  (println (remote-control-health/advance-footer-streak! \"$ROOT/.swarmforge\" \"coder\" :failed))
  (println (remote-control-health/advance-footer-streak! \"$ROOT/.swarmforge\" \"coder\" :unknown))
  (println (remote-control-health/advance-footer-streak! \"$ROOT/.swarmforge\" \"coder\" :healthy))
  (println (remote-control-health/advance-footer-streak! \"$ROOT/.swarmforge\" \"coder\" :failed))")"
[[ "$(sed -n 1p <<<"$out")" == "0" ]] || fail "11: an unseeded role's streak must start at 0 (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "1" ]] || fail "11: a single :failed observation -> streak 1 (not yet persistent) (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "2" ]] || fail "11: a second CONSECUTIVE :failed observation -> streak 2 (got: $out)"
[[ "$(sed -n 4p <<<"$out")" == "2" ]] || fail "11: :unknown neither advances nor resets an existing streak (got: $out)"
[[ "$(sed -n 5p <<<"$out")" == "0" ]] || fail "11: a :healthy observation resets the streak (got: $out)"
[[ "$(sed -n 6p <<<"$out")" == "1" ]] || fail "11: the streak restarts from 1 after a reset (got: $out)"
pass "11: advance-footer-streak! persists consecutive :failed observations ACROSS process calls, :unknown is neutral, :healthy resets"

# ── unit: classify-session only ever reclassifies what classify calls :healthy
out="$(bb -e "(load-file \"$LIB\")
  (println (name (remote-control-health/classify-session \"A\" \"A\" true 0)))
  (println (name (remote-control-health/classify-session \"A\" \"A\" true 1)))
  (println (name (remote-control-health/classify-session \"A\" \"A\" true 2)))
  (println (name (remote-control-health/classify-session \"A\" \"A\" true 5)))
  (println (name (remote-control-health/classify-session \"A\" nil true 2)))
  (println (name (remote-control-health/classify-session \"A\" \"B\" true 2)))
  (println (name (remote-control-health/classify-session \"A\" nil false 2)))
  (println (name (remote-control-health/classify-session nil nil false 2)))")"
[[ "$(sed -n 1p <<<"$out")" == "healthy" ]]      || fail "12: streak 0, matching flag -> :healthy (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "healthy" ]]      || fail "12: streak 1 (not yet persistent) -> still :healthy (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "session-dead" ]] || fail "12: streak 2, matching flag -> :session-dead (got: $out)"
[[ "$(sed -n 4p <<<"$out")" == "session-dead" ]] || fail "12: streak above threshold -> still :session-dead (got: $out)"
[[ "$(sed -n 5p <<<"$out")" == "degraded" ]]     || fail "12: flag ABSENT must stay :degraded even with a high streak - BL-514's case, untouched (got: $out)"
[[ "$(sed -n 6p <<<"$out")" == "degraded" ]]     || fail "12: WRONG flag must stay :degraded even with a high streak (got: $out)"
[[ "$(sed -n 7p <<<"$out")" == "down" ]]         || fail "12: no live process must stay :down, never :session-dead (got: $out)"
[[ "$(sed -n 8p <<<"$out")" == "off" ]]          || fail "12: RC disabled must stay :off, never :session-dead (got: $out)"
pass "12: classify-session adds :session-dead only where classify already says :healthy, :degraded/:down/:off are byte-for-byte untouched"

# ── unit: actionable? now also fires for :session-dead ──────────────────────
out="$(bb -e "(load-file \"$LIB\")
  (doseq [s [:off :down :healthy :degraded :session-dead]]
    (println s (remote-control-health/actionable? s)))")"
grep -q ':session-dead true' <<<"$out" || fail "13: :session-dead must be actionable (got: $out)"
grep -q ':degraded true'     <<<"$out" || fail "13: :degraded must still be actionable (got: $out)"
grep -q ':healthy false'     <<<"$out" || fail "13: :healthy must not be actionable (got: $out)"
grep -q ':down false'        <<<"$out" || fail "13: :down deferred to pane check (got: $out)"
grep -q ':off false'         <<<"$out" || fail "13: :off must not be actionable (got: $out)"
pass "13: actionable? routes :session-dead through the SAME predicate every existing repair caller already asks"

# ── integration: check-role's new 6-arg arity produces :session-dead; the
#    pre-existing 4/5-arg arities are entirely unaffected by a persisted
#    streak (BL-514 backward compatibility) ──────────────────────────────────
printf 'claude --dangerously-skip-permissions --remote-control SwarmForge-QA --append-system-prompt-file x\n' \
  > "$ROOT/.swarmforge/launch/qa.sh"
out="$(bb -e "(load-file \"$LIB\")
  (remote-control-health/advance-footer-streak! \"$ROOT/.swarmforge\" \"qa\" :failed)
  (remote-control-health/advance-footer-streak! \"$ROOT/.swarmforge\" \"qa\" :failed)
  (let [streak (remote-control-health/read-footer-streak \"$ROOT/.swarmforge\" \"qa\")
        cmdline-fn (fn [_ _] \"claude --dangerously-skip-permissions --remote-control SwarmForge-QA --append-system-prompt-file x\")]
    (println (name (:status (remote-control-health/check-role
      \"$ROOT/.swarmforge\" \"sock\" \"qa\" \"swarmforge-qa\" cmdline-fn streak))))
    (println (name (:status (remote-control-health/check-role
      \"$ROOT/.swarmforge\" \"sock\" \"qa\" \"swarmforge-qa\" cmdline-fn)))))")"
[[ "$(sed -n 1p <<<"$out")" == "session-dead" ]] || fail "14: check-role's 6-arg arity did not produce :session-dead from a persisted streak of 2; got: $out"
[[ "$(sed -n 2p <<<"$out")" == "healthy" ]]      || fail "14: check-role's ORIGINAL 5-arg arity must stay :healthy regardless of a persisted footer streak; got: $out"
pass "14: check-role's new footer-streak arity produces :session-dead; every pre-existing arity (BL-514, remote_control_health.bb --fix) is untouched"

# ── unit: wait-until-idle! only ever reports idle when the target genuinely
#    is idle (or the budget was spent) - never claims idle while busy ───────
out="$(bb -e "(load-file \"$LIB\")
  (let [n (atom 0)]
    (println (remote-control-health/wait-until-idle! (fn [] false) 30 3000 (fn [_] (swap! n inc))))
    (println @n))
  (let [n (atom 0)]
    (println (remote-control-health/wait-until-idle! (fn [] true) 5 3000 (fn [_] (swap! n inc))))
    (println @n))
  (let [ticks (atom 0)]
    (println (remote-control-health/wait-until-idle!
      (fn [] (<= (swap! ticks inc) 2)) 30 3000 (fn [_] nil))))")"
[[ "$(sed -n 1p <<<"$out")" == "true" ]]  || fail "15: a never-busy target is reported idle immediately (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "0" ]]     || fail "15: a never-busy target must never poll/sleep at all (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "false" ]] || fail "15: an always-busy target times out - it is never reported idle just because the budget ran out (got: $out)"
[[ "$(sed -n 4p <<<"$out")" == "2" ]]     || fail "15: a 5s budget / 3s poll interval must stop after exactly 2 polls (got: $out)"
[[ "$(sed -n 5p <<<"$out")" == "true" ]]  || fail "15: a target that goes idle partway through the wait is reported idle, not timed out (got: $out)"
pass "15: wait-until-idle! (invariant 1's machinery) never reports idle while the target is actually busy"

# ── unit: confirm-rc! polls until the flag matches, never fabricates a URL ──
out="$(bb -e "(load-file \"$LIB\")
  (println (:ok (remote-control-health/confirm-rc!
    (fn [] \"claude --remote-control SwarmForge-Coder\") (fn [] \"blah\") \"SwarmForge-Coder\" 5 10 (fn [_] nil))))
  (let [attempt (atom 0)]
    (println (:ok (remote-control-health/confirm-rc!
      (fn [] (swap! attempt inc)
        (if (>= @attempt 3) \"claude --remote-control SwarmForge-Coder\" \"claude --remote-control SwarmForge-Stale\"))
      (fn [] \"https://claude.ai/code/session_xyz\") \"SwarmForge-Coder\" 5 10 (fn [_] nil)))))
  (println (:url (remote-control-health/confirm-rc!
    (fn [] \"claude --remote-control SwarmForge-Coder\") (fn [] \"blah\nhttps://claude.ai/code/session_new\")
    \"SwarmForge-Coder\" 5 10 (fn [_] nil))))
  (let [r (remote-control-health/confirm-rc!
            (fn [] \"claude --remote-control SwarmForge-Stale\") (fn [] \"no url\") \"SwarmForge-Coder\" 2 10 (fn [_] nil))]
    (println (:ok r))
    (println (or (:url r) \"NONE\")))")"
[[ "$(sed -n 1p <<<"$out")" == "true" ]]                                  || fail "16: an already-matching flag confirms immediately (got: $out)"
[[ "$(sed -n 2p <<<"$out")" == "true" ]]                                  || fail "16: confirms once the flag appears within the try budget (got: $out)"
[[ "$(sed -n 3p <<<"$out")" == "https://claude.ai/code/session_new" ]]    || fail "16: the fresh session URL is read via session-url-in-capture (got: $out)"
[[ "$(sed -n 4p <<<"$out")" == "false" ]]                                 || fail "16: a flag that never appears fails confirmation (got: $out)"
[[ "$(sed -n 5p <<<"$out")" == "NONE" ]]                                  || fail "16: a failed confirmation must never fabricate a URL (got: $out)"
pass "16: confirm-rc! confirms the flag before returning a URL, and never invents one on failure"

# ── unit: repair-notice-text (invariant 2: always told, never a fabricated
#    address) ──────────────────────────────────────────────────────────────
out="$(bb -e "(load-file \"$LIB\")
  (println (remote-control-health/repair-notice-text \"coordinator\" \"https://claude.ai/code/session_abc\"))
  (println (remote-control-health/repair-notice-text \"coordinator\" nil))")"
line1="$(sed -n 1p <<<"$out")"
line2="$(sed -n 2p <<<"$out")"
[[ "$line1" == *"https://claude.ai/code/session_abc"* ]] || fail "17: a readable address must appear verbatim in the notice (got: $line1)"
[[ "$line2" != *"https://"* ]]                            || fail "17: an unreadable address must never be fabricated in the notice (got: $line2)"
[[ "$line2" == *"could not be read"* ]]                   || fail "17: an unreadable address gets an explicit statement, never silence (got: $line2)"
pass "17: repair-notice-text always states the outcome - the real address when readable, an explicit statement when not, never a fabricated one"

echo "ALL PASS"
