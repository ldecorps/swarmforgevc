#!/usr/bin/env bb
;; BL-1492 acceptance driver: drives the REAL handoffd_supervisor.bb
;; respond-to-verdict! (decide-response + restart-daemon!/alarm-and-halt!)
;; against a throwaway fixture root - never a reimplementation. halt-swarm!
;; and start-daemon! are stubbed inside the CLI so a real tmux kill or a real
;; daemon (re)start is never reached; the alarm email is suppressed by
;; daemon_alarm_lib.bb's own test-fixture-root? fail-safe (the fixture root
;; always resolves under the system temp dir) - but the CLI also stubs the
;; supervisor's own send-configured-alarm-email! directly so the subject
;; text (naming a restart vs a halt) is observable without depending on
;; conf-file/env plumbing.
;;
;; Input JSON: {verdict ("stalled"|"dead"), restartHistory: [{ageMs,
;;              result}], startOwnerFails, ticks}
;; Output JSON: {startDaemonCount, haltCount, emailSubjects,
;;               restartHistoryAfter, state}
;;
;; BL-1688: `ticks` (default 1, backward compatible with every existing
;; caller) repeats respond-to-verdict! that many times IN SEQUENCE,
;; re-reading status from disk before each call - the same "fresh per
;; tick" shape check! itself uses - so a multi-tick scenario (budget
;; exhaustion, the third verdict halting) is driven through the real
;; decision wiring rather than asserted once and extrapolated. The
;; stubbed start-daemon! also performs its OWN read-merge-write status
;; write before returning (state healthy, restart_history preserved) -
;; the real start owner's own fix (this ticket), not a reimplementation -
;; so this fixture proves the ledger the REAL subprocess boundary would
;; touch still survives, never only the supervisor's own in-memory
;; bookkeeping.

(ns bl1492-restart-in-place-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def repo-root (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." "..")))
(def scripts-dir (str (fs/path repo-root "swarmforge" "scripts")))

(def fixture-root (str (fs/create-temp-dir {:prefix "bl1492-restart-"})))

;; BL-459 temp-dir trap: reclaim the root on every exit path.
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? fixture-root) (fs/delete-tree fixture-root)))))

;; handoffd_supervisor.bb unconditionally calls (-main) at load time, which
;; (with no --check-once flag) enters its supervision while-loop. Pre-seed
;; stop-file so that loop is a no-op at load (same trick bl1491's fixture CLI
;; relies on), then remove it so this CLI's own respond-to-verdict! call
;; below is the only thing that actually runs.
(def daemon-dir* (fs/path fixture-root ".swarmforge" "daemon"))
(fs/create-dirs daemon-dir*)
(def stop-file* (fs/path daemon-dir* "stop"))
(spit (str stop-file*) "")

(binding [*command-line-args* [fixture-root]]
  (load-file (str (fs/path scripts-dir "handoffd_supervisor.bb"))))

(fs/delete-if-exists stop-file*)

(def input (json/parse-string (slurp *in*) true))
(def verdict (keyword (or (:verdict input) "stalled")))
(def restart-history-in (or (:restartHistory input) []))
(def start-owner-fails? (boolean (:startOwnerFails input)))
(def ticks (or (:ticks input) 1))

(def now-ms (handoffd-supervisor/now-ms))

;; ageMs is how long ago (relative to "now") each prior restart happened -
;; the shape the feature's own Given steps speak in ("already restarted...
;; within the window" / "healthy for longer than the window").
(def seeded-history
  (mapv (fn [{:keys [ageMs result]}]
          {:at (- now-ms ageMs) :result (or result "succeeded") :reason (name verdict)})
        restart-history-in))

(handoffd-supervisor/write-status! {:restart_history seeded-history})

(def start-daemon-count (atom 0))
(def halt-count (atom 0))
(def email-subjects (atom []))

(alter-var-root #'handoffd-supervisor/start-daemon!
                (fn [_]
                  (fn []
                    (swap! start-daemon-count inc)
                    ;; BL-1688: the real start owner performs its own
                    ;; read-merge-write status rewrite (state healthy,
                    ;; restart_history preserved) before success/failure
                    ;; is even known - the real fix this ticket makes,
                    ;; not a reimplementation of restart-daemon!'s own
                    ;; (later, in-memory-snapshot-based) final write.
                    ;; Mirrored here so a multi-tick run proves the
                    ;; ledger survives that interleaved write too.
                    (let [current (or (handoffd-supervisor/read-status) {})]
                      (handoffd-supervisor/write-status! (assoc current :state "healthy")))
                    {:success (not start-owner-fails?)})))

(alter-var-root #'handoffd-supervisor/halt-swarm!
                (fn [_]
                  (fn []
                    (swap! halt-count inc))))

;; Never a hand-rolled stand-in for the real send-configured-email! path -
;; only the LAST adapter hop (which would otherwise reach conf-file/env
;; resolution and a suppressed-but-real HTTP client construction) is
;; replaced, so the subject text daemon_alarm_lib.bb's build-alarm-email/
;; build-restart-alarm-email actually produced is what gets captured here.
(alter-var-root #'handoffd-supervisor/send-configured-alarm-email!
                (fn [_]
                  (fn [subject _text _attachments]
                    (swap! email-subjects conj subject)
                    {:success true})))

;; Drives the exact wiring handoffd_supervisor.bb's own check! uses on a
;; :dead/:stalled verdict - never a hand-rolled call into decide-response or
;; restart-daemon!/alarm-and-halt! directly, so a future rewire of
;; respond-to-verdict!'s decision is caught here too. Status is re-read
;; from disk before EACH tick (the same "fresh per tick" shape check!
;; itself uses), never carried in-memory across ticks - a multi-tick run
;; (ticks > 1) proves the ON-DISK ledger accumulates correctly call over
;; call, not merely an in-memory value threaded by this harness.
(dotimes [_ ticks]
  (let [status (or (handoffd-supervisor/read-status) {})]
    (handoffd-supervisor/respond-to-verdict! verdict status)))

(def final-status (handoffd-supervisor/read-status))

(println
 (json/generate-string
  {:startDaemonCount @start-daemon-count
   :haltCount @halt-count
   :emailSubjects @email-subjects
   :restartHistoryAfter (:restart_history final-status)
   :state (:state final-status)}))

(fs/delete-tree fixture-root)
