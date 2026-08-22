#!/usr/bin/env bash
# BL-144: daemon-death alarm. On daemon death the supervisor must (instead of
# restarting) write a failure log, send one alarm email via the shared
# notification mechanism, and hard-stop the swarm - the decision/rendering
# logic in daemon_alarm_lib.bb is a testable module (fake clock, fake
# adapters, no real network/tmux), driven here through
# daemon_alarm_test_runner.bb.
#
# Covers acceptance scenarios BL-144 daemon-death-alarm-01, 02, 05 (the
# content/orchestration half; 03/04 - actual hard-stop and no-auto-restart -
# are covered by test_handoffd_supervisor.sh's wiring into the real
# supervisor).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/daemon_alarm_test_runner.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# BL-646: run from a throwaway git root so any CWD-relative fixture write is caught.
GUARD_ROOT="$(mktemp -d)"
git -C "$GUARD_ROOT" init -q
GUARD_ROOT="$(cd "$GUARD_ROOT" && pwd -P)"
cd "$GUARD_ROOT"

assert_no_untracked_in_root() {
  local root="$1"
  local leaked
  leaked="$(git -C "$root" status --porcelain | grep '^??' || true)"
  if [[ -n "$leaked" ]]; then
    echo "FAIL: clean-working-tree guard: untracked file(s) in $root:" >&2
    echo "$leaked" >&2
    return 1
  fi
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT" "$GUARD_ROOT"' EXIT

# ── BL-646: runner refuses to write relative to CWD ─────────────────────────
if bb "$RUNNER" >/dev/null 2>&1; then
  fail "BL-646: runner must exit non-zero without fixture-root"
fi
pass "BL-646: runner refuses missing fixture-root"

if bb "$RUNNER" "/home/carillon/swarmforgevc" >/dev/null 2>&1; then
  fail "BL-646: runner must exit non-zero for a non-temp fixture-root"
fi
pass "BL-646: runner refuses non-temp fixture-root"

# ── BL-646 seeded-leak-fails-the-guard-02 ───────────────────────────────────
LEAK_ROOT="$(mktemp -d)"
git -C "$LEAK_ROOT" init -q
echo "leaked fixture output" > "$LEAK_ROOT/calls.log"
if assert_no_untracked_in_root "$LEAK_ROOT" 2>"$LEAK_ROOT/guard.err"; then
  fail "BL-646 seeded-leak-02: guard must fail when calls.log is present"
fi
grep -q "calls.log" "$LEAK_ROOT/guard.err" \
  || fail "BL-646 seeded-leak-02: failure must name calls.log, got: $(cat "$LEAK_ROOT/guard.err")"
pass "BL-646 seeded-leak-02: clean-working-tree guard fails and names the leaked file"
rm -rf "$LEAK_ROOT"

bb "$RUNNER" "$ROOT"

# ── 01: failure log captures death timestamp, log tail, history, role counts ─
[[ -f "$ROOT/failure.log" ]] || fail "01: failure log was never written"
grep -q "died_at: 2026-07-07T08:00:00Z" "$ROOT/failure.log" || fail "01: missing death timestamp"
grep -q "reason: dead" "$ROOT/failure.log" || fail "01: missing death reason"
grep -q "line one" "$ROOT/failure.log" || fail "01: missing daemon log tail"
grep -q "coder: inbox/new=2 outbox=1" "$ROOT/failure.log" || fail "01: missing per-role inbox/outbox snapshot"
grep -q "restart_history" "$ROOT/failure.log" || fail "01: missing restart history"
pass "01: failure log contains death timestamp, log tail, history, and per-role counts"

# ── 02: exactly one alarm email is sent, naming the failure log and recovery command ─
CALL_COUNT="$(grep -c "^send-email" "$ROOT/calls.log")"
[[ "$CALL_COUNT" -eq 1 ]] || fail "02: expected exactly one send-email call, got $CALL_COUNT"
grep -q "Failure log: $ROOT/failure.log" "$ROOT/email-text.txt" || fail "02: email did not name the failure log path"
grep -q "run: ./swarm ensure" "$ROOT/email-text.txt" || fail "02: email did not name the recovery command"
pass "02: exactly one alarm email sent, naming the failure log path and recovery command"

# ── BL-813 attach-01: the death alarm email carries exactly one attachment
#    whose bytes match the written failure log byte-for-byte ────────────────
ATTACH_COUNT="$(python3 -c "import json; print(len(json.load(open('$ROOT/email-attachments.json'))))")"
[[ "$ATTACH_COUNT" -eq 1 ]] || fail "BL-813 attach-01: expected exactly 1 attachment, got $ATTACH_COUNT"

ATTACH_FILENAME="$(python3 -c "import json; print(json.load(open('$ROOT/email-attachments.json'))[0]['filename'])")"
[[ "$ATTACH_FILENAME" == "failure.log" ]] || fail "BL-813 attach-01: expected attachment filename 'failure.log', got '$ATTACH_FILENAME'"

if ! python3 - "$ROOT/email-attachments.json" "$ROOT/failure.log" <<'PYEOF'
import base64
import json
import sys

attachments_path, failure_log_path = sys.argv[1], sys.argv[2]
att = json.load(open(attachments_path))[0]
decoded = base64.b64decode(att["base64"])
expected = open(failure_log_path, "rb").read()
assert decoded == expected, "decoded attachment bytes did not match the failure-log file bytes"
PYEOF
then
  fail "BL-813 attach-01: decoded attachment bytes did not match the written failure-log content"
fi
pass "BL-813 attach-01: the death alarm email carries exactly one attachment whose bytes match the written failure log"

# ── 03: the swarm is halted (adapter invoked) before status is written ───────
grep -q "^halt-swarm" "$ROOT/calls.log" || fail "03: halt-swarm! was never invoked"
pass "03: halt-swarm! invoked as part of the orchestration"

# ── 04: terminal status is 'halted', not a restart state ────────────────────
STATE="$(python3 -c "import json; print(json.load(open('$ROOT/status.json'))['state'])")"
[[ "$STATE" == "halted" ]] || fail "04: expected terminal state 'halted', got '$STATE'"
FAILURE_LOG_FIELD="$(python3 -c "import json; print(json.load(open('$ROOT/status.json'))['failure_log'])")"
[[ "$FAILURE_LOG_FIELD" == "$ROOT/failure.log" ]] || fail "04: status did not record the failure log path"
pass "04: status file records a terminal 'halted' state and the failure log path (no restart, no backoff)"

# ── 05: email-not-configured is reported, not thrown, and never touches the network ─
cat > "$ROOT/unconfigured_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [result (daemon-alarm-lib/send-alarm-email! nil "" "onboarding@resend.dev" "subj" "text"
               (fn [& _] (throw (ex-info "must never be called" {}))))]
  (assert (false? (:success result)) "expected success=false when unconfigured")
  (println "unconfigured-ok"))
EOF
bb "$ROOT/unconfigured_test.bb" | grep -q "unconfigured-ok" || fail "05: missing to/api-key must not attempt a real send"
pass "05: send-alarm-email! reports missing configuration instead of attempting a network call"

# ── BL-215 warn-01: recipient set but key missing warns loudly, once ────────
cat > "$ROOT/warn_missing_key_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [result (daemon-alarm-lib/send-alarm-email! nil "ops@example.com" "onboarding@resend.dev" "subj" "text"
               (fn [& _] (throw (ex-info "must never be called" {}))))
      warnings (atom [])
      warned? (atom false)]
  (assert (false? (:success result)) "expected success=false when the key is missing")
  (assert (= :missing-api-key (:reason result)) "expected a distinct :missing-api-key reason")
  (daemon-alarm-lib/warn-missing-key-if-needed!
   result
   {:already-warned?! (fn [] @warned?)
    :log-warning! (fn [msg] (swap! warnings conj msg))
    :mark-warned! (fn [] (reset! warned? true))})
  (assert (= 1 (count @warnings)) "expected exactly one warning logged")
  (assert (re-find #"RESEND_API_KEY" (first @warnings)) "expected the warning to name RESEND_API_KEY")
  (println "warn-missing-key-ok"))
EOF
bb "$ROOT/warn_missing_key_test.bb" | grep -q "warn-missing-key-ok" \
  || fail "warn-01: expected a distinct missing-key result and a loud warning naming RESEND_API_KEY"
pass "BL-215 warn-01: recipient set but key missing returns a distinct result and warns loudly"

# ── BL-215 warn-02: no recipient stays a quiet no-op (no warning, ever) ──────
cat > "$ROOT/warn_no_recipient_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [result (daemon-alarm-lib/send-alarm-email! nil "" "onboarding@resend.dev" "subj" "text"
               (fn [& _] (throw (ex-info "must never be called" {}))))
      warnings (atom [])]
  (assert (= :disabled (:reason result)) "expected a :disabled reason when no recipient is configured")
  (daemon-alarm-lib/warn-missing-key-if-needed!
   result
   {:already-warned?! (fn [] false)
    :log-warning! (fn [msg] (swap! warnings conj msg))
    :mark-warned! (fn [] (throw (ex-info "must never mark warned" {})))})
  (assert (empty? @warnings) "expected no warning when email is intentionally off")
  (println "warn-no-recipient-ok"))
EOF
bb "$ROOT/warn_no_recipient_test.bb" | grep -q "warn-no-recipient-ok" \
  || fail "warn-02: a recipient-unset no-op must never log the missing-key warning"
pass "BL-215 warn-02: no recipient stays a quiet no-op, no missing-key warning"

# ── BL-215 warn-03: fully configured sends normally, no warning ─────────────
cat > "$ROOT/warn_fully_configured_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [result (daemon-alarm-lib/send-alarm-email! "fake-key" "ops@example.com" "onboarding@resend.dev" "subj" "text"
               (fn [_api-key _msg] {:success true}))
      warnings (atom [])]
  (assert (true? (:success result)) "expected the send to succeed when fully configured")
  (assert (nil? (:reason result)) "expected no :reason on a real send attempt")
  (daemon-alarm-lib/warn-missing-key-if-needed!
   result
   {:already-warned?! (fn [] false)
    :log-warning! (fn [msg] (swap! warnings conj msg))
    :mark-warned! (fn [] (throw (ex-info "must never mark warned" {})))})
  (assert (empty? @warnings) "expected no warning when fully configured")
  (println "warn-fully-configured-ok"))
EOF
bb "$ROOT/warn_fully_configured_test.bb" | grep -q "warn-fully-configured-ok" \
  || fail "warn-03: a fully-configured send must never log the missing-key warning"
pass "BL-215 warn-03: fully configured sends normally, no missing-key warning"

# ── BL-215 warn-04: the missing-key warning is not spammed across repeats ───
cat > "$ROOT/warn_dedup_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [result (daemon-alarm-lib/send-alarm-email! nil "ops@example.com" "onboarding@resend.dev" "subj" "text"
               (fn [& _] (throw (ex-info "must never be called" {}))))
      warnings (atom [])
      warned? (atom false)
      warn-once! (fn []
                   (daemon-alarm-lib/warn-missing-key-if-needed!
                    result
                    {:already-warned?! (fn [] @warned?)
                     :log-warning! (fn [msg] (swap! warnings conj msg))
                     :mark-warned! (fn [] (reset! warned? true))}))]
  (dotimes [_ 5] (warn-once!))
  (assert (= 1 (count @warnings)) (str "expected exactly one warning across 5 calls, got " (count @warnings)))
  (println "warn-dedup-ok"))
EOF
bb "$ROOT/warn_dedup_test.bb" | grep -q "warn-dedup-ok" \
  || fail "warn-04: expected the missing-key warning deduped across repeated send attempts"
pass "BL-215 warn-04: the missing-key warning is deduped, not emitted on every send attempt"

# ── BL-260 html-01: send-alarm-email!'s 7-arg form threads html to post-fn! ──
# (post-fn! is always a fake here, same as every test above - default-post!
# itself is real network I/O and is never called directly by these tests.)
cat > "$ROOT/html_threaded_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [captured (atom nil)
      result (daemon-alarm-lib/send-alarm-email! "fake-key" "ops@example.com" "onboarding@resend.dev" "subj" "text"
               "<p>diagram</p>"
               (fn [_api-key msg] (reset! captured msg) {:success true}))]
  (assert (true? (:success result)) "expected the send to succeed")
  (assert (= "<p>diagram</p>" (:html @captured)) "expected the html body to reach post-fn!")
  (assert (= "text" (:text @captured)) "expected the text body to still reach post-fn! alongside html")
  (println "html-threaded-ok"))
EOF
bb "$ROOT/html_threaded_test.bb" | grep -q "html-threaded-ok" \
  || fail "BL-260 html-01: expected the 7-arg send-alarm-email! form to thread html through to post-fn!"
pass "BL-260 html-01: the 7-arg send-alarm-email! form threads an html body through to post-fn!"

# ── BL-260 html-02: the existing 6-arg form is unaffected - no :html key at all ──
cat > "$ROOT/html_absent_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [captured (atom nil)]
  (daemon-alarm-lib/send-alarm-email! "fake-key" "ops@example.com" "onboarding@resend.dev" "subj" "text"
    (fn [_api-key msg] (reset! captured msg) {:success true}))
  (assert (not (contains? @captured :html)) "expected no :html key at all when the pre-BL-260 6-arg form is used")
  (println "html-absent-ok"))
EOF
bb "$ROOT/html_absent_test.bb" | grep -q "html-absent-ok" \
  || fail "BL-260 html-02: expected the pre-BL-260 6-arg form to carry no :html key"
pass "BL-260 html-02: the pre-existing 6-arg form is unaffected - carries no :html key"

# ── BL-286 attachments-01: send-alarm-email!'s 8-arg form threads attachments to post-fn! ──
cat > "$ROOT/attachments_threaded_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [captured (atom nil)
      attachments [{:filename "architecture-diagram.png" :content-id "architecture-diagram" :base64 "QUJD"}]
      result (daemon-alarm-lib/send-alarm-email! "fake-key" "ops@example.com" "onboarding@resend.dev" "subj" "text"
               "<p>diagram</p>" attachments
               (fn [_api-key msg] (reset! captured msg) {:success true}))]
  (assert (true? (:success result)) "expected the send to succeed")
  (assert (= attachments (:attachments @captured)) "expected the attachments to reach post-fn! unchanged")
  (assert (= "<p>diagram</p>" (:html @captured)) "expected the html body to still reach post-fn! alongside attachments")
  (println "attachments-threaded-ok"))
EOF
bb "$ROOT/attachments_threaded_test.bb" | grep -q "attachments-threaded-ok" \
  || fail "BL-286 attachments-01: expected the 8-arg send-alarm-email! form to thread attachments through to post-fn!"
pass "BL-286 attachments-01: the 8-arg send-alarm-email! form threads attachments through to post-fn!"

# ── BL-286 attachments-02: the existing 7-arg form is unaffected - no :attachments key at all ──
cat > "$ROOT/attachments_absent_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [captured (atom nil)]
  (daemon-alarm-lib/send-alarm-email! "fake-key" "ops@example.com" "onboarding@resend.dev" "subj" "text" "<p>diagram</p>"
    (fn [_api-key msg] (reset! captured msg) {:success true}))
  (assert (not (contains? @captured :attachments)) "expected no :attachments key at all when the pre-BL-286 7-arg form is used")
  (println "attachments-absent-ok"))
EOF
bb "$ROOT/attachments_absent_test.bb" | grep -q "attachments-absent-ok" \
  || fail "BL-286 attachments-02: expected the pre-BL-286 7-arg form to carry no :attachments key"
pass "BL-286 attachments-02: the pre-existing 7-arg form is unaffected - carries no :attachments key"

# ── BL-326: test-fixture-root? - the automatic, no-cooperation-required signal ──
cat > "$ROOT/test_fixture_root_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(assert (true? (daemon-alarm-lib/test-fixture-root? "$ROOT/nested/fixture")) "01: a path under the system temp dir must read as a test fixture")
(assert (false? (daemon-alarm-lib/test-fixture-root? "/home/carillon/swarmforgevc")) "02: a real, non-temp project root must NOT read as a test fixture")
(assert (false? (daemon-alarm-lib/test-fixture-root? "/srv/swarm")) "03: an arbitrary non-temp root must NOT read as a test fixture")
(println "test-fixture-root-ok")
EOF
bb "$ROOT/test_fixture_root_test.bb" | grep -q "test-fixture-root-ok" \
  || fail "BL-326: test-fixture-root? did not correctly distinguish temp vs real roots"
pass "BL-326: test-fixture-root? identifies a temp-directory root, and only a temp-directory root"

# ── BL-326 test-suite-never-emails-02: a test-fixture root never sends, even fully configured ──
cat > "$ROOT/suppressed_send_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [conf-file "$ROOT/fixture.conf"
      _ (spit conf-file "config notify_email_to real-human@example.com\n")
      result (daemon-alarm-lib/send-configured-email!
              "$ROOT/nested/fixture" conf-file "subj" "text"
              {:already-warned?! (fn [] false)
               :log-warning! (fn [& _] (throw (ex-info "must never warn for a suppressed send" {})))
               :mark-warned! (fn [] (throw (ex-info "must never mark-warned for a suppressed send" {})))})]
  (assert (false? (:success result)) "expected success=false for a test-fixture root")
  (assert (= :test-fixture-suppressed (:reason result)) "expected :reason :test-fixture-suppressed")
  (println "suppressed-send-ok"))
EOF
env RESEND_API_KEY=fake-real-looking-key bb "$ROOT/suppressed_send_test.bb" | grep -q "suppressed-send-ok" \
  || fail "BL-326 test-suite-never-emails-02: a fully-configured (real key + real recipient) test-fixture-root send must still be suppressed"
pass "BL-326 test-suite-never-emails-02: a daemon rooted in a throwaway test directory never sends mail, even with a real key and a real recipient configured"

# ── BL-326: a REAL (non-temp) root still sends normally - the fail-safe is scoped, not global ──
cat > "$ROOT/real_root_still_sends_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [conf-file "$ROOT/fixture2.conf"
      _ (spit conf-file "config notify_email_to real-human@example.com\n")
      sent (atom false)
      real-post! (fn [_api-key _msg] (reset! sent true) {:success true})]
  (with-redefs [daemon-alarm-lib/default-post! real-post!]
    (daemon-alarm-lib/send-configured-email!
     "/home/carillon/swarmforgevc" conf-file "subj" "text"
     {:already-warned?! (fn [] false) :log-warning! (fn [& _] nil) :mark-warned! (fn [] nil)}))
  (assert (true? @sent) "expected a REAL (non-temp) project root to still attempt a real send")
  (println "real-root-sends-ok"))
EOF
env RESEND_API_KEY=fake-key bb "$ROOT/real_root_still_sends_test.bb" | grep -q "real-root-sends-ok" \
  || fail "BL-326: a real project root's alarm must still attempt to send - the fail-safe must not suppress everything"
pass "BL-326: a real (non-temp) project root's alarm still attempts to send - the fail-safe is scoped to test fixtures only"

# ── BL-326 test-suite-never-emails-04: a test-fixture root still warns loudly
#    when configured-but-keyless - the fail-safe intercepts only the actual
#    network POST, never the :missing-api-key decision above it ──────────
cat > "$ROOT/suppressed_still_warns_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [conf-file "$ROOT/fixture3.conf"
      _ (spit conf-file "config notify_email_to real-human@example.com\n")
      warned (atom false)
      result (daemon-alarm-lib/send-configured-email!
              "$ROOT/nested/fixture" conf-file "subj" "text"
              {:already-warned?! (fn [] false)
               :log-warning! (fn [msg] (reset! warned msg))
               :mark-warned! (fn [] nil)})]
  (assert (false? (:success result)) "expected success=false for a test-fixture root with no key")
  (assert (= :missing-api-key (:reason result)) "expected :reason :missing-api-key, NOT :test-fixture-suppressed - the key really is missing here")
  (assert (string? @warned) "expected the loud missing-key warning to still fire for a test-fixture root")
  (println "suppressed-still-warns-ok"))
EOF
env -u RESEND_API_KEY bb "$ROOT/suppressed_still_warns_test.bb" | grep -q "suppressed-still-warns-ok" \
  || fail "BL-326 test-suite-never-emails-04: a configured-but-keyless test-fixture-root daemon must still warn loudly (BL-215 behavior preserved)"
pass "BL-326 test-suite-never-emails-04: a configured-but-keyless daemon still warns loudly even when its root is a test fixture, and does not send an email"

# ── BL-406: refuse-tmp-daemon-start? - the front-door guard handoffd.bb's
#    own startup checks, before test-fixture-root?'s send-path fail-safe
#    is ever reached ──────────────────────────────────────────────────────
cat > "$ROOT/refuse_tmp_daemon_start_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(assert (true? (daemon-alarm-lib/refuse-tmp-daemon-start? "$ROOT/nested/fixture" nil))
  "01: a temp-directory root with no allow flag must be refused")
(assert (true? (daemon-alarm-lib/refuse-tmp-daemon-start? "$ROOT/nested/fixture" ""))
  "02: a temp-directory root with a blank allow flag must be refused")
(assert (false? (daemon-alarm-lib/refuse-tmp-daemon-start? "$ROOT/nested/fixture" "1"))
  "03: a temp-directory root WITH an explicit allow flag must NOT be refused")
(assert (false? (daemon-alarm-lib/refuse-tmp-daemon-start? "/home/carillon/swarmforgevc" nil))
  "04: a real, non-temp project root must NOT be refused even with no allow flag")
(assert (false? (daemon-alarm-lib/refuse-tmp-daemon-start? "/srv/swarm" nil))
  "05: an arbitrary non-temp root must NOT be refused")
(assert (true? (daemon-alarm-lib/refuse-tmp-daemon-start? "$ROOT/nested/fixture" "   "))
  "06: a whitespace-only allow flag is blank and must still be refused")
(assert (false? (daemon-alarm-lib/refuse-tmp-daemon-start? "$ROOT/nested/fixture" "0"))
  "07: ANY non-blank flag value opts in by design, including \"0\" - never inferred as falsy")
(println "refuse-tmp-daemon-start-ok")
EOF
bb "$ROOT/refuse_tmp_daemon_start_test.bb" | grep -q "refuse-tmp-daemon-start-ok" \
  || fail "BL-406: refuse-tmp-daemon-start? did not gate correctly on root shape + explicit allow flag"
pass "BL-406: refuse-tmp-daemon-start? refuses a temp-directory root by default, only allowing it with an explicit opt-in flag, and never refuses a real project root"

# ── BL-902: email-send-reason / configured-email-send-reason (pure) ─────────
# The knowledge send-alarm-email!'s cond already had (to/api-key blank
# checks), factored out so a caller with an expensive-to-build message
# (briefing_email_lib.bb) can decide sendability BEFORE paying that cost.
cat > "$ROOT/email_send_reason_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(assert (= :disabled (daemon-alarm-lib/email-send-reason "" "fake-key")) "01: blank to -> :disabled")
(assert (= :disabled (daemon-alarm-lib/email-send-reason nil "fake-key")) "02: nil to -> :disabled")
(assert (= :missing-api-key (daemon-alarm-lib/email-send-reason "ops@example.com" "")) "03: blank api-key -> :missing-api-key")
(assert (= :missing-api-key (daemon-alarm-lib/email-send-reason "ops@example.com" nil)) "04: nil api-key -> :missing-api-key")
(assert (nil? (daemon-alarm-lib/email-send-reason "ops@example.com" "fake-key")) "05: both present -> nil (sendable)")
(assert (= :disabled (daemon-alarm-lib/email-send-reason "" "")) "06: both blank -> :disabled (recipient checked first)")
(println "email-send-reason-ok")
EOF
bb "$ROOT/email_send_reason_test.bb" | grep -q "email-send-reason-ok" \
  || fail "BL-902: email-send-reason did not compute the expected verdict for every to/api-key combination"
pass "BL-902: email-send-reason computes :disabled/:missing-api-key/nil exactly as send-alarm-email!'s own cond always did"

# ── BL-902: send-alarm-email!'s own result is unchanged after refactoring
#    its cond to delegate to email-send-reason (regression guard) ───────────
cat > "$ROOT/send_alarm_email_reason_regression_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [disabled (daemon-alarm-lib/send-alarm-email! "fake-key" "" "onboarding@resend.dev" "subj" "text"
                 (fn [& _] (throw (ex-info "must never be called" {}))))
      missing-key (daemon-alarm-lib/send-alarm-email! "" "ops@example.com" "onboarding@resend.dev" "subj" "text"
                    (fn [& _] (throw (ex-info "must never be called" {}))))]
  (assert (= {:success false :reason :disabled :error "email not configured (notify_email_to unset)"} disabled)
    "expected the exact pre-refactor :disabled result shape")
  (assert (= {:success false :reason :missing-api-key :error "email not configured (missing RESEND_API_KEY)"} missing-key)
    "expected the exact pre-refactor :missing-api-key result shape")
  (println "send-alarm-email-reason-regression-ok"))
EOF
bb "$ROOT/send_alarm_email_reason_regression_test.bb" | grep -q "send-alarm-email-reason-regression-ok" \
  || fail "BL-902: send-alarm-email!'s :disabled/:missing-api-key result shape changed after delegating to email-send-reason"
pass "BL-902: send-alarm-email!'s own result shape is byte-identical after delegating its cond to email-send-reason"

# ── BL-902: configured-email-send-reason reads conf-file + env exactly like
#    send-configured-email! does, with no compose/send side effect ──────────
cat > "$ROOT/configured_email_send_reason_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [conf-file "$ROOT/bl902_fixture.conf"]
  (spit conf-file "config notify_email_to ops@example.com\n")
  (assert (= :missing-api-key (daemon-alarm-lib/configured-email-send-reason conf-file))
    "01: recipient configured, no key in env -> :missing-api-key")
  (println "configured-email-send-reason-missing-key-ok"))
EOF
env -u RESEND_API_KEY bb "$ROOT/configured_email_send_reason_test.bb" | grep -q "configured-email-send-reason-missing-key-ok" \
  || fail "BL-902: configured-email-send-reason did not report :missing-api-key for a configured-but-keyless conf"
pass "BL-902 configured-email-send-reason-01: recipient configured, key absent from env -> :missing-api-key, no compose/send"

cat > "$ROOT/configured_email_send_reason_sendable_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [conf-file "$ROOT/bl902_fixture2.conf"]
  (spit conf-file "config notify_email_to ops@example.com\n")
  (assert (nil? (daemon-alarm-lib/configured-email-send-reason conf-file))
    "expected nil (sendable) when both recipient and key are present")
  (println "configured-email-send-reason-sendable-ok"))
EOF
env RESEND_API_KEY=fake-key bb "$ROOT/configured_email_send_reason_sendable_test.bb" | grep -q "configured-email-send-reason-sendable-ok" \
  || fail "BL-902: configured-email-send-reason did not report nil (sendable) when fully configured"
pass "BL-902 configured-email-send-reason-02: fully configured -> nil (sendable)"

cat > "$ROOT/configured_email_send_reason_disabled_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [conf-file "$ROOT/bl902_fixture3.conf"]
  (assert (= :disabled (daemon-alarm-lib/configured-email-send-reason conf-file))
    "expected :disabled for a conf-file with no notify_email_to at all (or missing entirely)")
  (println "configured-email-send-reason-disabled-ok"))
EOF
bb "$ROOT/configured_email_send_reason_disabled_test.bb" | grep -q "configured-email-send-reason-disabled-ok" \
  || fail "BL-902: configured-email-send-reason did not report :disabled for a missing/no-recipient conf-file"
pass "BL-902 configured-email-send-reason-03: no notify_email_to configured (conf-file absent) -> :disabled"

# ── BL-646 suites-leave-no-untracked-files-01 ───────────────────────────────
assert_no_untracked_in_root "$GUARD_ROOT" \
  || fail "BL-646 suites-leave-no-untracked-files-01: daemon-death/alarm suite left debris in guard root"
pass "BL-646 suites-leave-no-untracked-files-01: suite leaves guard root clean"

echo "ALL PASS"
