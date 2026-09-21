#!/usr/bin/env bb
;; BL-1458 hardening: instruct-documenter-briefing!'s own comment states "a
;; delivery error is retried on the next tick rather than silently dropped
;; for the day" - marking the once-per-day marker ONLY on a successful send.
;; No existing test drove the failure branch (the real daemon wiring test,
;; the acceptance feature, and the property test all only exercise a
;; succeeding send) - a mutant that marks unconditionally survived every one
;; of them (confirmed by hand: `(if true ...)` in place of `(if (zero?
;; (:exit result)) ...)` still passed the full existing suite). Drives the
;; REAL private function via with-redefs on the one subprocess seam
;; (daemon-cycle-guard-lib/sh!), the same stubbing shape
;; bl1494_post_qa_sweep_wake_field_test_runner.bb already uses for a
;; sibling handoffd.bb function.
;;
;; handoffd.bb's `(apply -main ...)` is BL-1395-guarded, so load-file here
;; analyses it silently - it never starts the daemon. project-root resolves
;; from *command-line-args*, which `binding` (not alter-var-root - that did
;; NOT take effect, verified) rebinds to a fresh mkdtemp root for the
;; duration of the load, so this runner is self-contained: no external args,
;; no pollution of the invoking cwd (bl1494's own runner, invoked with no
;; args, leaks a literal ./bl1395-load-probe-no-root directory into
;; wherever it is run from - observed live in the repo root; a real,
;; pre-existing defect, out of scope for this ticket, not touched here).
;; SWARMFORGE_ALLOW_TMP_DAEMON=1 (BL-406) is required for a tmp-rooted
;; project-root at all; exported here so no caller has to remember it.

(require '[babashka.fs :as fs])

(def scripts-dir-abs (str (fs/parent (fs/parent (fs/canonicalize *file*)))))

;; Re-exec self with the env var set BEFORE creating our own fixture root -
;; bb has no setenv for the CURRENT process and handoffd.bb reads the
;; process env directly, so the child gets its own fresh root and this
;; process (the parent) never creates one it would only have to discard.
(when (nil? (System/getenv "SWARMFORGE_ALLOW_TMP_DAEMON"))
  (let [{:keys [exit out err]} (babashka.process/shell
                                 {:continue true :out :string :err :string
                                  :extra-env {"SWARMFORGE_ALLOW_TMP_DAEMON" "1"}}
                                 "bb" (str *file*))]
    (print out) (flush)
    (binding [*out* *err*] (print err) (flush))
    (System/exit exit)))

(def root (str (fs/create-temp-dir {:prefix "bl1458-instruct-briefing-"})))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))
(defn pass! [msg] (println (str "PASS: " msg)))

;; load-file runs as its own top-level form, BEFORE the try below - SCI
;; analyses a try body as one unit ahead of running any of it, so a
;; handoffd/... symbol referenced inside the SAME try as the load-file that
;; defines that namespace fails analysis even though it would resolve fine
;; at runtime (verified: moving load-file into the try produced "Unable to
;; resolve symbol: handoffd/state-dir" at the analysis phase).
(binding [*command-line-args* [root]]
  (load-file (str (fs/path scripts-dir-abs "handoffd.bb"))))

(try
  (let [marker-exists? (fn [day-key]
                          (fs/exists? (fs/path handoffd/state-dir "briefing" (str "instructed-" day-key))))]

    ;; ── a failed send: no marker, error logged, nothing silently dropped ──
    (with-redefs [daemon-cycle-guard-lib/sh! (fn [& _] {:exit 1 :out "" :err "simulated send failure"})]
      (handoffd/instruct-documenter-briefing! "2099-01-01" "produce the morning briefing for 2099-01-01"))

    (if (marker-exists? "2099-01-01")
      (fail! "a failed send must NOT create the once-per-day marker (would silently skip the day's retry), but it did")
      (pass! "a failed send creates no once-per-day marker"))

    (let [logged (slurp (str handoffd/log-file))]
      (if (re-find #"briefing-generation-note-error 2099-01-01" logged)
        (pass! "a failed send logs briefing-generation-note-error naming the day-key")
        (fail! (str "expected briefing-generation-note-error 2099-01-01 in the log, got:\n" logged))))

    ;; ── a retried tick after the failure: no marker means it is NOT skipped ─
    (with-redefs [daemon-cycle-guard-lib/sh! (fn [& _] {:exit 0 :out "" :err ""})]
      (handoffd/instruct-documenter-briefing! "2099-01-01" "produce the morning briefing for 2099-01-01"))

    (if (marker-exists? "2099-01-01")
      (pass! "a retried tick (after the earlier failure) can still send and marks the day instructed")
      (fail! "expected the retry to succeed and mark the day instructed - the earlier failure must not have wedged it"))

    (let [logged (slurp (str handoffd/log-file))]
      (if (re-find #"briefing-generation-note-queued 2099-01-01" logged)
        (pass! "the retry logs briefing-generation-note-queued naming the day-key")
        (fail! (str "expected briefing-generation-note-queued 2099-01-01 in the log, got:\n" logged))))

    ;; ── a successful send on a FRESH day-key: marks instructed, no error ──
    (with-redefs [daemon-cycle-guard-lib/sh! (fn [& _] {:exit 0 :out "" :err ""})]
      (handoffd/instruct-documenter-briefing! "2099-01-02" "produce the morning briefing for 2099-01-02"))

    (if (marker-exists? "2099-01-02")
      (pass! "a successful send marks the day-key instructed")
      (fail! "expected a successful send to mark the day-key instructed"))

    ;; ── already instructed: the send is skipped, never called twice ──────
    (let [called (atom 0)]
      (with-redefs [daemon-cycle-guard-lib/sh! (fn [& _] (swap! called inc) {:exit 0 :out "" :err ""})]
        (handoffd/instruct-documenter-briefing! "2099-01-02" "produce the morning briefing for 2099-01-02"))
      (if (zero? @called)
        (pass! "a day already marked instructed sends nothing on a later tick")
        (fail! (str "expected NO send for an already-instructed day, got " @called " call(s)")))))

  (finally
    (fs/delete-tree root {:force true})))

(if (empty? @failures)
  (println "ALL PASS: instruct-documenter-briefing!")
  (do (doseq [f @failures] (println (str "FAIL: " f)))
      (System/exit 1)))
