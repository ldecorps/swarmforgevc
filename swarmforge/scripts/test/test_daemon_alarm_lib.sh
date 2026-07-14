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

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

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

echo "ALL PASS"
