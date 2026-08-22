;; BL-823: swarm availability interval ledger, Babashka reader side.
;;
;; Two interval classes have no durable record today - control/cooldown
;; pauses (a current-state marker resume overwrites) and stop-to-start gaps
;; (a stop writes nothing). The writers are TS
;; (extension/src/metrics/availabilityLedgerStore.ts's appendAvailabilityRecord,
;; called by the two pause twins) and shell
;; (availability_ledger_lib.sh's availability_record, called by
;; kill_pipeline_swarm.sh/start-swarm.sh) - this lib is the sole reader,
;; folding their shared `.swarmforge/telemetry/availability-YYYY-MM.jsonl`
;; records into intervals. Out of scope here (BL-823's own out_of_scope):
;; subtracting these intervals from anything, or touching
;; flow_watchdog_lib.bb - that is BL-650, which depends on this ticket and
;; will call `fold` below as its own entry point.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "availability_ledger_lib.bb")))
;; and referred to as availability-ledger-lib/foo.

(ns availability-ledger-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(defn telemetry-dir [state-dir]
  (fs/path state-dir "telemetry"))

(def ^:private ledger-file-name-pattern #"^availability-\d{4}-\d{2}\.jsonl$")

(defn ledger-files
  "Every monthly ledger file under state-dir/telemetry, sorted chronologically
   (fixed-width YYYY-MM filenames sort lexically == chronologically, the
   same convention llm_cost_ledger_lib.bb relies on). Empty when the
   telemetry dir does not exist yet - never a crash on a fresh project."
  [state-dir]
  (let [dir (telemetry-dir state-dir)]
    (if-not (fs/exists? dir)
      []
      (->> (fs/list-dir dir)
           (filter #(re-matches ledger-file-name-pattern (fs/file-name %)))
           (map str)
           sort
           vec))))

(defn- parse-instant-ms
  "Pure: an ISO-8601 instant string to epoch millis, or nil when unparseable
   - never throws. A record whose :ts fails this is corrupt (BL-823
   invariant 2) even if its JSON otherwise parsed."
  [ts]
  (try (.toEpochMilli (java.time.Instant/parse ts)) (catch Exception _ nil)))

(defn- parse-record
  "One JSONL line -> {:ts :event :class :source}, or nil for a blank,
   malformed-JSON, missing-field, or unparseable-timestamp line. The reader
   SKIPS these (BL-823 invariant 2 / acceptance scenario 06) rather than
   inventing a record that is not there or crashing the whole fold."
  [line]
  (when-not (str/blank? line)
    (try
      (let [parsed (json/parse-string line true)
            ts (:ts parsed)
            event (:event parsed)
            cls (:class parsed)]
        (when (and (string? ts) (string? event) (string? cls) (parse-instant-ms ts))
          {:ts ts :event event :class cls :source (:source parsed)}))
      (catch Exception _ nil))))

(defn read-records
  "Every valid record across every monthly ledger file (BL-823 acceptance
   scenario 08 spans this across a month boundary), sorted chronologically by
   :ts - this is what makes out-of-order lines within or across files
   tolerated (BL-823 invariant 2) rather than assumed pre-sorted."
  [state-dir]
  (->> (ledger-files state-dir)
       (mapcat (fn [f] (str/split-lines (slurp f))))
       (keep parse-record)
       (sort-by :ts)
       vec))

;; ── fold: records -> intervals ──────────────────────────────────────────

(defn fold-intervals
  "records (chronologically sorted, e.g. from read-records) -> a vector of
   {:start-ms :end-ms :class :provenance} intervals. Every emitted interval
   carries an explicit :provenance - \"proven\" (both ends are real
   records), \"inferred\" (the closing stop was the heartbeat-synthesized
   one, BL-823 point 3 - told apart by its own :source \"heartbeat-inferred\",
   never a separate guessed field), or \"open\" (no closing record exists
   yet - :end-ms is nil, never a guessed timestamp). This is BL-823
   invariant 3.

   control-pause: pause-start paired with the NEXT pause-end. A trailing
   unmatched pause-start is emitted OPEN (acceptance scenario 07). A
   pause-end with no open pause-start has nothing to close and is ignored.

   swarm-stop: stop paired with the NEXT start (acceptance scenario 02/08).
   A trailing unmatched stop is emitted OPEN. A start with no preceding open
   stop has nothing to pair with and yields no interval for that gap - this
   is what naturally makes an ungraceful stop with no heartbeat evidence
   emit nothing at all (acceptance scenario 04): the ledger just holds two
   consecutive start records with no stop between them, and neither pairs."
  [records]
  (let [parse-ms (fn [ts] (.toEpochMilli (java.time.Instant/parse ts)))]
    (loop [records (seq records)
           open-pause nil
           open-stop nil
           intervals []]
      (if-let [{:keys [ts event] :as record} (first records)]
        (let [ms (parse-ms ts)]
          (case event
            "pause-start"
            (recur (next records) record open-stop intervals)

            "pause-end"
            (if open-pause
              (recur (next records) nil open-stop
                     (conj intervals {:start-ms (parse-ms (:ts open-pause))
                                       :end-ms ms
                                       :class "control-pause"
                                       :provenance "proven"}))
              (recur (next records) open-pause open-stop intervals))

            "stop"
            (recur (next records) open-pause record intervals)

            "start"
            (if open-stop
              (recur (next records) open-pause nil
                     (conj intervals {:start-ms (parse-ms (:ts open-stop))
                                       :end-ms ms
                                       :class "swarm-stop"
                                       :provenance (if (= (:source open-stop) "heartbeat-inferred") "inferred" "proven")}))
              (recur (next records) open-pause open-stop intervals))

            ;; An unrecognized-but-well-formed event is skipped without
            ;; disturbing open state - never a crash on a forward-compatible
            ;; record shape.
            (recur (next records) open-pause open-stop intervals)))
        (cond-> intervals
          open-pause (conj {:start-ms (parse-ms (:ts open-pause)) :end-ms nil :class "control-pause" :provenance "open"})
          open-stop (conj {:start-ms (parse-ms (:ts open-stop)) :end-ms nil :class "swarm-stop" :provenance "open"}))))))

(defn fold
  "Convenience entry point: reads every ledger record under state-dir and
   folds it into intervals in one call - never subtracts them from anything
   (that is BL-650's own job, which depends on this ticket)."
  [state-dir]
  (fold-intervals (read-records state-dir)))

;; Allow `bb availability_ledger_lib.bb` to be a no-op load (it is a library).
(when (= *file* (System/getProperty "babashka.file")) nil)
