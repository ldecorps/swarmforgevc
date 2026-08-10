#!/usr/bin/env bb
;; Acceptance runner for BL-840: takes a subcommand (argv 0) and a JSON
;; payload (argv 1), prints a JSON result. Same JSON-bridge pattern as the
;; BL-849/BL-486/BL-458 acceptance runners, so the Node step handlers drive
;; the REAL producer (provider_outage_evidence_lib.bb/record-provider-outage!),
;; the REAL reader (evidence-for-provider), and the REAL production sweep
;; (flow_watchdog_lib.bb/run-sweep!, wired the same way handoffd.bb wires
;; it) rather than reimplementing any of this in JS.
(ns bl840-provider-outage-evidence-acceptance-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [cheshire.core :as json]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "agent_runtime_lib.bb")))
(load-file (str (fs/path here ".." "provider_outage_evidence_lib.bb")))
(load-file (str (fs/path here ".." "flow_watchdog_lib.bb")))

(def subcommand (first *command-line-args*))
(def payload (when-let [raw (second *command-line-args*)] (json/parse-string raw true)))

(def created-temp-dirs (atom []))
;; BL-872: shutdown hook mirrors handoff_lib_test_runner.bb (BL-459) - fires
;; on both a clean run and an uncaught exception, never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- mk-tmp-dir []
  (let [d (str (fs/create-temp-dir))]
    (swap! created-temp-dirs conj d)
    d))

(defn- parse-ms [iso] (.toEpochMilli (java.time.Instant/parse iso)))

;; Observes one pane snapshot the same way handoffd.bb's
;; observe-pane-provider-outage! does: classify, and if :unavailable,
;; record-provider-outage! - never a hand-rolled shortcut around the real
;; classifier or the real throttled producer.
(defn- observe-pane! [state-dir role provider text now-ms min-interval-ms]
  (when (= :unavailable (:category (agent-runtime-lib/classify-provider-error text)))
    (provider-outage-evidence-lib/record-provider-outage!
     state-dir role provider text now-ms min-interval-ms)))

;; bl840-01/02: one observation, count resulting lines.
(defmulti run identity)

(defmethod run "observe-and-count" [_]
  (let [tmp (mk-tmp-dir)
        role (:role payload)
        provider (:provider payload)
        text (:text payload)
        now-ms (parse-ms (:observedAt payload))]
    (observe-pane! tmp role provider text now-ms 60000)
    (let [lines (provider-outage-evidence-lib/evidence-for-provider tmp provider)]
      {:lineCount (count lines)
       :lines (map (fn [l] {:tsMs (:ts-ms l) :text (:text l)}) lines)})))

;; bl840-03: a pre-seeded evidence line, then one more observation at a
;; given time - count lines recorded BY THAT SECOND observation only.
(defmethod run "observe-after-seed" [_]
  (let [tmp (mk-tmp-dir)
        role (:role payload)
        provider (:provider payload)
        seeded-at-ms (parse-ms (:seededAt payload))
        observed-at-ms (parse-ms (:observedAt payload))
        min-interval-ms (:minIntervalMs payload)]
    (provider-outage-evidence-lib/record-provider-outage!
     tmp role provider "API Error: 529 overloaded_error" seeded-at-ms min-interval-ms)
    (let [before (count (provider-outage-evidence-lib/evidence-for-provider tmp provider))]
      (observe-pane! tmp role provider "API Error: 529 overloaded_error" observed-at-ms min-interval-ms)
      (let [after (count (provider-outage-evidence-lib/evidence-for-provider tmp provider))]
        {:furtherLines (- after before)}))))

;; Invariant 2 (property test): a whole SEQUENCE of observation times (ms
;; offsets from an arbitrary base) against ONE shared state-dir, min-interval
;; fixed - returns the resulting line count so a property test can compare
;; it against an independently-computed expected count.
(defmethod run "throttle-sequence" [_]
  (let [tmp (mk-tmp-dir)
        role (:role payload)
        provider (:provider payload)
        min-interval-ms (:minIntervalMs payload)
        base-ms 1700000000000]
    (doseq [offset-ms (:offsetsMs payload)]
      (observe-pane! tmp role provider "API Error: 529 overloaded_error" (+ base-ms offset-ms) min-interval-ms))
    {:lineCount (count (provider-outage-evidence-lib/evidence-for-provider tmp provider))}))

;; bl840-04/05: build a real mailbox fixture + a real (or absent/corrupt)
;; evidence file, run the REAL flow-watchdog-lib/run-sweep! end to end
;; (proving "the sweep completes without error"), and separately read wall/
;; effective age via evaluate-effective-age fed by the SAME real evidence
;; reader (provider-outage-evidence-lib/evidence-for-provider) - never a
;; hand-fabricated evidence vector.
(defn- write-handoff! [path headers]
  (fs/create-dirs (fs/parent path))
  (spit path (str (apply str (for [[k v] headers] (str k ": " v "\n"))) "\nbody\n")))

(defmethod run "sweep-parcel" [_]
  (let [root (mk-tmp-dir)
        state-dir (str (fs/path root ".swarmforge"))
        daemon-dir (fs/path state-dir "daemon")
        new-dir (fs/path root "coder" "inbox" "new")
        now-ms (parse-ms (:sweepAt payload))
        role (:role payload)
        provider (:roleProvider payload)]
    (write-handoff! (str (fs/path new-dir "p1.handoff"))
                     [["id" "p1"] ["from" "specifier"] ["to" role] ["type" "note"]
                      ["enqueued_at" (:enqueuedAt payload)]])
    ;; evidence store setup, per the scenario's own <evidence state>.
    (case (:evidenceState payload)
      "holds-outage"
      ;; Seeds observation points every 5 minutes across the span - real
      ;; throttled observation ticks, well inside flow_watchdog_lib.bb's
      ;; own 10-minute gap-grouping window, so provider-outage-intervals
      ;; reconstructs ONE continuous interval spanning start..end (exactly
      ;; what a standing banner observed once a sweep produces), not two
      ;; disconnected zero-duration points.
      (let [start-ms (parse-ms (:evidenceStart payload))
            end-ms (parse-ms (:evidenceEnd payload))]
        (doseq [ts-ms (range start-ms (inc end-ms) 300000)]
          (provider-outage-evidence-lib/record-provider-outage!
           state-dir "coder" (:evidenceProvider payload) "API Error: 529 overloaded_error" ts-ms 0)))
      "empty"
      (fs/create-dirs (provider-outage-evidence-lib/telemetry-dir state-dir))
      "missing"
      nil
      "corrupt"
      (do (fs/create-dirs (provider-outage-evidence-lib/telemetry-dir state-dir))
          (spit (str (fs/path (provider-outage-evidence-lib/telemetry-dir state-dir) "provider-outage-2026-08.jsonl"))
                "not valid json {{{\n"))
      nil)
    (let [alarms (atom [])
          swept? (atom false)
          error (atom nil)
          roles {role {:agent provider}}]
      (try
        (flow-watchdog-lib/run-sweep!
         [{:role role :new-dir new-dir :in-process-dir (fs/path root role "inbox" "in_process")}]
         now-ms root daemon-dir
         {:live-session? (fn [_] false)
          :emit-alarm! (fn [text] (swap! alarms conj text) true)
          :provider-outage-evidence-for
          (fn [r] (if-let [p (:agent (get roles r))]
                    (provider-outage-evidence-lib/evidence-for-provider state-dir p)
                    []))})
        (reset! swept? true)
        (catch Exception e (reset! error (.getMessage e))))
      (let [eff (flow-watchdog-lib/evaluate-effective-age
                 {:enqueued-at (:enqueuedAt payload)
                  :now-ms now-ms
                  :ledger-intervals []
                  :provider-evidence (if provider
                                        (provider-outage-evidence-lib/evidence-for-provider state-dir provider)
                                        [])})]
        {:sweptWithoutError (and @swept? (nil? @error))
         :sweepError @error
         :wallAgeMs (:wall-age-ms eff)
         :effectiveAgeMs (:effective-age-ms eff)}))))

(println (json/generate-string (run subcommand)))
