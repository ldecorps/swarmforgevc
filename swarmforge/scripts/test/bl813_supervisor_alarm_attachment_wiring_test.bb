#!/usr/bin/env bb
;; BL-813 required_wiring: "handoffd_supervisor.bb::send-configured-alarm-
;; email!::the supervisor death path must use the attachment-capable email
;; sender, not only mention the file path." daemon_alarm_test_runner.bb
;; already proves alarm-and-halt! BUILDS and threads an attachment
;; (test_daemon_alarm_lib.sh's BL-813 attach-01); this test proves the
;; SUPERVISOR's own adapter (send-configured-alarm-email!) actually forwards
;; that attachments arg into daemon-alarm-lib/send-configured-email!'s
;; 7-arg (attachment-capable) form, rather than silently dropping it - the
;; two ends of the same wire.
;;
;; handoffd_supervisor.bb defines `project-root` from *command-line-args* at
;; TOP LEVEL and unconditionally runs (-main) at the bottom of the file, so
;; loading it in-process needs two things this harness sets up before
;; load-file: (1) *command-line-args* bound to a throwaway fixture root (no
;; --check-once, so -main takes the supervision-loop branch), and (2) that
;; fixture root's daemon/stop file already touched, so the loop's `(while
;; (not (fs/exists? stop-file)) ...)` condition is false from the very first
;; check and the loop body (a real check! - reap-orphans!, live daemon
;; health eval) never runs at all. -main still writes+deletes its own
;; supervisor-pid-file and logs one "started"/"stopped" line - harmless,
;; confirmed by hand against a real load.
;;
;; Usage: bl813_supervisor_alarm_attachment_wiring_test.bb <fixture-root>
;; (same non-temp-root refusal convention as daemon_alarm_test_runner.bb -
;; test-fixture-root? below is daemon_alarm_lib.bb's own guard, loaded
;; transitively.)

(ns bl813-supervisor-alarm-attachment-wiring-test
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(defn die! [msg]
  (binding [*out* *err*] (println msg))
  (System/exit 1))

(let [raw-arg (nth *command-line-args* 0 nil)]
  (when (or (nil? raw-arg) (str/blank? (str raw-arg)))
    (die! "ERROR: requires a non-blank <fixture-root> argument (must be under the system temp directory)."))
  (def fixture-root (str/trim (str raw-arg))))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def daemon-dir (fs/path fixture-root ".swarmforge" "daemon"))
(fs/create-dirs daemon-dir)
(spit (str (fs/path daemon-dir "stop")) "")

(binding [*command-line-args* [fixture-root]]
  (load-file (str (fs/path script-dir ".." "handoffd_supervisor.bb"))))

(when-not (daemon-alarm-lib/test-fixture-root? fixture-root)
  (die! (str "ERROR: fixture-root must be under the system temp directory, got: " (pr-str fixture-root))))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── the wiring check itself ───────────────────────────────────────────────
;; Intercepts ONLY daemon-alarm-lib/send-configured-email! (the one function
;; every attachment must pass through to reach the network) - never touches
;; the real Resend client, matching this suite's own "no real network in
;; unit tests" gate.

(def captured (atom :not-called))

(def fake-attachments [{:filename "handoffd-failure-20260805T141124Z.log"
                         :content-id "handoffd-failure-log"
                         :base64 "aGVsbG8="}])

(with-redefs [daemon-alarm-lib/send-configured-email!
              (fn [project-root conf-file subject text html attachments warn-adapters]
                (reset! captured {:project-root project-root :conf-file conf-file :subject subject
                                   :text text :html html :attachments attachments})
                {:success true})]
  (handoffd-supervisor/send-configured-alarm-email! "subj" "text body" fake-attachments))

(assert= "send-configured-alarm-email! forwards the attachments arg unchanged to daemon-alarm-lib/send-configured-email!"
         fake-attachments
         (:attachments @captured))

(assert= "send-configured-alarm-email! still forwards subject/text unchanged"
         ["subj" "text body"]
         [(:subject @captured) (:text @captured)])

(assert= "send-configured-alarm-email! forwards project-root as the supervisor's own project-root"
         fixture-root
         (:project-root @captured))

;; ── regression: the pre-BL-813 2-arg call shape must be gone ────────────
;; A caller passing only (subject text) - the OLD arity - must fail loudly
;; (arity mismatch), not silently drop attachments. This is the actual
;; "not only mention the file path" defect: before this fix, the function
;; only ever forwarded subject/text, so attachments had nowhere to go.
(def arity-2-still-works?
  (try
    (handoffd-supervisor/send-configured-alarm-email! "subj" "text body")
    true
    (catch clojure.lang.ArityException _ false)))

(assert= "the pre-BL-813 2-arg (subject text) call shape no longer compiles/works - attachments is now a required 3rd arg"
         false
         arity-2-still-works?)

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: bl813 supervisor alarm-attachment wiring"))
