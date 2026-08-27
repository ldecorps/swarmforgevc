#!/usr/bin/env bb
;; BL-813 coder pass (BL-654 Invariants): PROPERTY tests over
;; daemon_alarm_lib.bb encoding the ticket's 1st and 3rd declared invariants:
;;
;;   P1 attachment-fidelity - "A handoffd death alarm email always carries
;;      the written handoffd-failure-*.log as an attachment when email is
;;      configured, so an off-box operator can read the crash without SSH."
;;   P2 attachment-build-failure-never-blocks-halt - the other half of the
;;      same invariant's spirit: a failure while building the attachment
;;      must not prevent halt-swarm! (per the ticket's own e2e_qa_procedure
;;      step 2).
;;   P3 no-auto-restart-posture-unchanged - "BL-144 no-auto-restart /
;;      alarm-and-halt posture is unchanged."
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none).
;; See ambulance_lib_property_runner.bb's header for the Babashka-property-
;; tooling-gap note (BL-472) this one shares: no test.check equivalent is
;; wired for .bb scripts, so this is a hand-rolled generator in the actual
;; enforced gate for .bb code (swarmforge/scripts/test/).
;;
;; Non-vacuity proven by hand at authoring time: P1/P2 both failed when
;; alarm-and-halt! was temporarily reverted to call `(send-email! subject
;; text)` (no attachments arg, matching the pre-BL-813 shape) - P1 because
;; the captured attachments seq was empty/nil instead of carrying the exact
;; content, P2 vacuously passed (nothing to break) so it was re-checked
;; against a deliberately-thrown build-failure-attachment with the fix
;; applied but the try/catch removed, which broke halt-swarm! as expected.
;; P3 failed when write-status! was stubbed to skip the :state "halted"
;; assoc. All three were restored to the adopted fix before this commit.

(ns bl813-daemon-alarm-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_alarm_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; Small alphabet of log-tail lines, deliberately including an empty string,
;; a newline, a quote and a non-ASCII character - varied enough that a
;; byte-for-byte base64 round-trip bug (e.g. wrong charset) would show up,
;; without making any one run's content astronomically unlikely to hit an
;; edge case (the recorded generator-weighting lesson).
(def line-pool ["ordinary line" "" "line\nwith\nbreaks" "quote\"and'apostrophe" "emoji-🔥-line" "tab\ttab"])
(def reason-pool [:dead :stalled])

(defn gen-log-tail [s]
  (let [[n s1] (gen-int s 4)] ; 0..3 lines
    (reduce (fn [[acc sx] _]
              (let [[line sy] (gen-pick sx line-pool)] [(conj acc line) sy]))
            [[] s1] (range n))))

(defn gen-scenario [s]
  (let [[reason s1] (gen-pick s reason-pool)
        [log-tail s2] (gen-log-tail s1)]
    [{:reason reason :log-tail log-tail} s2]))

(defn- run-alarm! [{:keys [reason log-tail]} & {:keys [redefs]}]
  (let [captured-content (atom nil)
        captured-attachments (atom :unset)
        halt-count (atom 0)
        final-status (atom nil)
        failure-log-path "/fake/root/.swarmforge/daemon/handoffd-failure-20260101T000000Z.log"
        adapters {:reason reason
                  :status {}
                  :now-iso! (fn [] "2026-01-01T00:00:00Z")
                  :log-tail! (fn [] log-tail)
                  :role-counts! (fn [] [])
                  :write-failure-log! (fn [content] (reset! captured-content content) failure-log-path)
                  :send-email! (fn [_subject _text attachments] (reset! captured-attachments attachments) {:success true})
                  :halt-swarm! (fn [] (swap! halt-count inc))
                  :write-status! (fn [status] (reset! final-status status))}
        run! (fn [] (daemon-alarm-lib/alarm-and-halt! adapters))]
    (if redefs (redefs run!) (run!))
    {:content @captured-content
     :attachments @captured-attachments
     :failure-log-path failure-log-path
     :halt-count @halt-count
     :final-status @final-status}))

;; ── P1: attachment fidelity ──────────────────────────────────────────────
;; Independent oracle: `content` is captured at the write-failure-log!
;; adapter boundary (the exact bytes the daemon believes it wrote to disk),
;; never re-derived from format-failure-log's own internals.

(check-all "P1 attachment-fidelity: the email always attaches the exact just-written failure-log content" gen-scenario
  (fn [scenario]
    (let [{:keys [content attachments failure-log-path]} (run-alarm! scenario)
          decoder (java.util.Base64/getDecoder)]
      (cond
        (not (sequential? attachments))
        (str "expected attachments to be a seq, got " (pr-str attachments))

        (not= 1 (count attachments))
        (str "expected exactly 1 attachment, got " (count attachments) ": " (pr-str attachments))

        (not= (str (fs/file-name failure-log-path)) (:filename (first attachments)))
        (str "filename mismatch: expected " (fs/file-name failure-log-path) " got " (:filename (first attachments)))

        (not= content (String. (.decode decoder ^String (:base64 (first attachments))) "UTF-8"))
        (str "decoded attachment bytes did not match the exact written failure-log content; content=" (pr-str content))

        :else true))))

;; ── P2: an attachment-build failure never blocks halt-swarm! ────────────

(check-all "P2 attachment-build-failure-never-blocks-halt: halt-swarm! and the halted status write still happen" gen-scenario
  (fn [scenario]
    (let [{:keys [halt-count final-status]}
          (run-alarm! scenario
                      :redefs (fn [run!]
                                (with-redefs [daemon-alarm-lib/build-failure-attachment
                                              (fn [_] (throw (ex-info "simulated attachment-build failure" {})))]
                                  (run!))))]
      (cond
        (not= 1 halt-count) (str "expected halt-swarm! called exactly once despite the attachment-build failure, got " halt-count)
        (not= "halted" (:state final-status)) (str "expected final state \"halted\", got " (pr-str (:state final-status)))
        :else true))))

;; ── P3: no-auto-restart posture is unchanged ─────────────────────────────
;; prior-status sometimes already carries a :state key (including
;; "healthy") to prove the final write always overrides to "halted"
;; regardless of whatever state preceded the death - never a path that
;; could look like an auto-restart.

(def prior-state-pool [nil "healthy" "halted" "restarting"])

(defn gen-p3-scenario [s]
  (let [[reason s1] (gen-pick s reason-pool)
        [log-tail s2] (gen-log-tail s1)
        [prior-state s3] (gen-pick s2 prior-state-pool)]
    [{:reason reason :log-tail log-tail :prior-state prior-state} s3]))

(check-all "P3 no-auto-restart-posture: halt-swarm! fires exactly once and the final state is always \"halted\"" gen-p3-scenario
  (fn [{:keys [reason log-tail prior-state]}]
    (let [halt-count (atom 0)
          final-status (atom nil)
          adapters {:reason reason
                    :status (cond-> {} prior-state (assoc :state prior-state))
                    :now-iso! (fn [] "2026-01-01T00:00:00Z")
                    :log-tail! (fn [] log-tail)
                    :role-counts! (fn [] [])
                    :write-failure-log! (fn [_content] "/fake/path.log")
                    :send-email! (fn [_subject _text _attachments] {:success true})
                    :halt-swarm! (fn [] (swap! halt-count inc))
                    :write-status! (fn [status] (reset! final-status status))}]
      (daemon-alarm-lib/alarm-and-halt! adapters)
      (cond
        (not= 1 @halt-count) (str "expected halt-swarm! called exactly once, got " @halt-count)
        (not= "halted" (:state @final-status)) (str "expected final state \"halted\" regardless of prior-state=" (pr-str prior-state) ", got " (pr-str (:state @final-status)))
        (not= (name reason) (:reason (:last_incident @final-status))) "last_incident :reason did not match the given death reason"
        :else true))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl813 daemon_alarm_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
