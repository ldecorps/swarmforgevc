#!/usr/bin/env bb
;; Context Telemetry — pure event validation, normalization, and summary
;; aggregation over per-invocation context/compaction events (GH-22 Slice 1).
;; No disk IO here — context_telemetry_store.bb owns reading and writing
;; .swarmforge/telemetry/context-events.jsonl; this namespace only
;; transforms plain data. No wall-clock reads either: every timestamp
;; arrives as caller-supplied data (mirrors BL-525's exhaustion-detector
;; pin — pure predicate, injected signals, no wall-clock in the lib).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "context_telemetry_lib.bb")))
;; and referred to as context-telemetry-lib/foo.
(ns context-telemetry-lib
  (:require [clojure.string :as str]))

(def required-fields
  [:agent :role :session_id :timestamp :input_tokens :output_tokens
   :context_utilization_pct :compaction :provider :model])

;; estimated_cost_usd is intentionally optional/nullable (specifier pin 3 —
;; no pricing logic in Slice 1); every other numeric field must still parse
;; as a number when present.
(def numeric-fields
  [:input_tokens :output_tokens :tool_output_tokens :prompt_engine_tokens
   :system_prompt_tokens :history_tokens :context_utilization_pct
   :estimated_cost_usd])

(defn- present? [event k]
  (some? (get event k)))

(defn- finite? [n]
  (not (or (Double/isNaN n) (Double/isInfinite n))))

(defn- parse-number
  "nil on anything that isn't already a finite number or a numeric string —
   the sentinel validate-event checks for, never an exception (a CLI argv
   value like \"not-a-number\" must be REJECTED, not crash the process).
   Double/parseDouble happily parses \"NaN\"/\"Infinity\"/\"-Infinity\" as
   valid doubles, so those string forms are rejected explicitly here too —
   a non-finite token count or utilisation percentage is exactly the kind
   of malformed input this ticket's success criteria requires rejecting,
   not silently persisting."
  [v]
  (cond
    (number? v) (when (finite? v) v)
    (string? v) (try (let [n (Double/parseDouble v)]
                        (when (finite? n) n))
                      (catch Exception _ nil))
    :else nil))

(defn validate-event
  "Returns {:valid? true} or {:valid? false :error \"...\"}. Checked in two
   passes — missing required fields first, then non-numeric numeric fields
   — so the reported error always names one concrete offending field."
  [event]
  (if-let [missing (first (remove #(present? event %) required-fields))]
    {:valid? false :error (str "missing required field: " (name missing))}
    (if-let [bad (some (fn [k] (when (and (present? event k) (nil? (parse-number (get event k)))) k))
                       numeric-fields)]
      {:valid? false :error (str "non-numeric value for field: " (name bad))}
      {:valid? true})))

(defn normalize-event
  "Coerces argv-string numeric fields into real numbers and the compaction
   field into a real boolean. Assumes validate-event already passed — this
   never itself rejects a value, it only re-shapes an already-valid one
   before it is persisted."
  [event]
  (-> (reduce (fn [e k] (if (present? e k) (update e k parse-number) e))
              event numeric-fields)
      (update :compaction (fn [v] (if (string? v) (= v "true") (boolean v))))))

(defn- parse-instant [ts]
  (java.time.Instant/parse ts))

(defn- elapsed-ms [from-ts to-ts]
  (.toMillis (java.time.Duration/between (parse-instant from-ts) (parse-instant to-ts))))

(defn summarize
  "Pure aggregate over a coll of already-scoped events (agent-scoped, and
   optionally session-scoped — the caller/CLI does that filtering). Sorts by
   timestamp internally so callers never need to pre-sort."
  [events]
  (let [sorted (sort-by #(.toEpochMilli (parse-instant (:timestamp %))) events)
        n (count sorted)
        compactions (filter :compaction sorted)
        first-ts (:timestamp (first sorted))
        first-compaction-ts (:timestamp (first compactions))]
    {:event_count n
     :compaction_count (count compactions)
     :avg_context_utilization_pct (when (pos? n)
                                     (/ (reduce + (map :context_utilization_pct sorted)) (double n)))
     :time_to_first_compaction_ms (when (and first-ts first-compaction-ts)
                                     (elapsed-ms first-ts first-compaction-ts))}))
