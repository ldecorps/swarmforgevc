#!/usr/bin/env bash
# BL-976: unit tests for daemon_alarm_lib.bb's alert-keyless-if-needed! /
# format-keyless-alert - the pure decision half of "a configured-but-keyless
# daemon generation alerts the operator through Telegram exactly once".
# Fake adapters only (no real network, no live daemon, no real key); the
# environment-specific transport wiring is handoffd.bb's and is covered by
# the BL-976 acceptance feature.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../daemon_alarm_lib.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

run_bb() {
  bb -e "
(load-file \"$LIB\")
(in-ns 'daemon-alarm-lib)
$1
"
}

# ── 01: keyless + not yet alerted -> one send, then marked, in that order ───
out="$(run_bb '
(let [calls (atom [])]
  (alert-keyless-if-needed!
   :missing-api-key
   {:already-alerted?! (fn [] false)
    :send-alert! (fn [] (swap! calls conj :send))
    :mark-alerted! (fn [] (swap! calls conj :mark))})
  (println (pr-str @calls)))')"
[[ "$out" == "[:send :mark]" ]] || fail "01: expected [:send :mark], got: $out"
pass "01: keyless+unalerted sends then marks, in that order"

# ── 02: already alerted -> neither adapter runs ─────────────────────────────
out="$(run_bb '
(let [calls (atom [])]
  (alert-keyless-if-needed!
   :missing-api-key
   {:already-alerted?! (fn [] true)
    :send-alert! (fn [] (swap! calls conj :send))
    :mark-alerted! (fn [] (swap! calls conj :mark))})
  (println (pr-str @calls)))')"
[[ "$out" == "[]" ]] || fail "02: expected no calls once alerted, got: $out"
pass "02: already-alerted repeat call is a no-op"

# ── 03: :disabled and sendable (nil) are both quiet no-ops ──────────────────
out="$(run_bb '
(let [calls (atom [])]
  (doseq [reason [:disabled nil]]
    (alert-keyless-if-needed!
     reason
     {:already-alerted?! (fn [] false)
      :send-alert! (fn [] (swap! calls conj :send))
      :mark-alerted! (fn [] (swap! calls conj :mark))}))
  (println (pr-str @calls)))')"
[[ "$out" == "[]" ]] || fail "03: expected no calls for :disabled/nil, got: $out"
pass "03: :disabled and sendable verdicts never alert"

# ── 04: a throwing transport leaves the alert UN-marked (retry semantics) ───
out="$(run_bb '
(let [marked (atom false)]
  (try
    (alert-keyless-if-needed!
     :missing-api-key
     {:already-alerted?! (fn [] @marked)
      :send-alert! (fn [] (throw (ex-info "transport down" {})))
      :mark-alerted! (fn [] (reset! marked true))})
    (catch Exception _ nil))
  (println (pr-str @marked)))')"
[[ "$out" == "false" ]] || fail "04: transport failure must not mark alerted, got: $out"
pass "04: transport failure leaves alert un-marked for the next cycle"

# ── 05: caller-loop shape - 3 keyless cycles on one atom -> exactly 1 send ──
out="$(run_bb '
(let [alerted (atom false)
      sends (atom 0)]
  (dotimes [_ 3]
    (alert-keyless-if-needed!
     :missing-api-key
     {:already-alerted?! (fn [] @alerted)
      :send-alert! (fn [] (swap! sends inc))
      :mark-alerted! (fn [] (reset! alerted true))}))
  (println @sends))')"
[[ "$out" == "1" ]] || fail "05: expected exactly 1 send across 3 cycles, got: $out"
pass "05: one generation-scoped atom yields exactly one send across cycles"

# ── 06: alert text names RESEND_API_KEY and the env file path ───────────────
out="$(run_bb '(println (format-keyless-alert "/fixture/.swarmforge/operator/daemon.env"))')"
echo "$out" | grep -q "RESEND_API_KEY" || fail "06: alert must name RESEND_API_KEY: $out"
echo "$out" | grep -q "/fixture/.swarmforge/operator/daemon.env" || fail "06: alert must name the env file path: $out"
pass "06: alert names RESEND_API_KEY and the operator env file path"

echo "ALL PASS"
