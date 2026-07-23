#!/usr/bin/env bb
;; TDD runner for context_telemetry_lib.bb — GH-22 Slice 1. Pure assertions,
;; no disk IO (context_telemetry_store.bb's fs adapter is covered by
;; test_context_telemetry_cli.sh instead) and no wall-clock reads — every
;; timestamp here is an explicit fixture string, mirroring BL-525's
;; exhaustion-detector pin (pure predicate, injected signals).
(ns context-telemetry-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "context_telemetry_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(defn valid-event [overrides]
  (merge {:agent "coder"
          :role "coder"
          :session_id "sess-1"
          :timestamp "2026-01-01T00:00:00Z"
          :input_tokens 1000
          :output_tokens 200
          :context_utilization_pct 42
          :compaction false
          :provider "anthropic"
          :model "claude-sonnet-5"}
         overrides))

;; ── validate-event: required fields ──────────────────────────────────────
(doseq [k [:agent :role :session_id :timestamp :input_tokens :output_tokens
           :context_utilization_pct :compaction :provider :model]]
  (let [event (dissoc (valid-event {}) k)
        {:keys [valid? error]} (context-telemetry-lib/validate-event event)]
    (assert-true (str "validate-event rejects a missing " (name k)) (not valid?))
    (assert-true (str "validate-event's error for missing " (name k) " names the field")
                 (and error (clojure.string/includes? error (name k))))))

(assert-true "validate-event accepts a fully-populated valid event"
             (:valid? (context-telemetry-lib/validate-event (valid-event {}))))

;; ── validate-event: numeric fields ───────────────────────────────────────
(doseq [k [:input_tokens :output_tokens :tool_output_tokens :prompt_engine_tokens
           :system_prompt_tokens :history_tokens :context_utilization_pct
           :estimated_cost_usd]]
  (let [event (valid-event {k "not-a-number"})
        {:keys [valid? error]} (context-telemetry-lib/validate-event event)]
    (assert-true (str "validate-event rejects a non-numeric " (name k)) (not valid?))
    (assert-true (str "validate-event's error for non-numeric " (name k) " names the field")
                 (and error (clojure.string/includes? error (name k))))))

(assert-true "validate-event accepts numeric-field values passed as numbers"
             (:valid? (context-telemetry-lib/validate-event (valid-event {:input_tokens 500}))))

(assert-true "validate-event accepts numeric-field values passed as numeric strings (CLI argv)"
             (:valid? (context-telemetry-lib/validate-event (valid-event {:input_tokens "500"}))))

(assert-true "validate-event accepts a nil optional numeric field (estimated_cost_usd)"
             (:valid? (context-telemetry-lib/validate-event (valid-event {:estimated_cost_usd nil}))))

;; ── normalize-event: coerces argv strings into real numbers/booleans ────
(let [normalized (context-telemetry-lib/normalize-event
                   (valid-event {:input_tokens "500" :output_tokens "10" :compaction "true"}))]
  (assert= "normalize-event coerces a numeric-string field to a number" 500.0 (:input_tokens normalized))
  (assert= "normalize-event coerces the compaction string \"true\" to boolean true" true (:compaction normalized))
  (assert-true "normalize-event leaves a real number untouched" (number? (:output_tokens normalized))))

(let [normalized (context-telemetry-lib/normalize-event (valid-event {:compaction "false"}))]
  (assert= "normalize-event coerces the compaction string \"false\" to boolean false" false (:compaction normalized)))

(let [normalized (context-telemetry-lib/normalize-event (valid-event {:estimated_cost_usd nil}))]
  (assert-true "normalize-event leaves a nil optional field as nil, not a fabricated 0"
               (nil? (:estimated_cost_usd normalized))))

;; ── summarize: compaction-count-and-average-utilisation-01 ───────────────
(let [events [(valid-event {:context_utilization_pct 30 :compaction false :timestamp "2026-01-01T00:00:00Z"})
              (valid-event {:context_utilization_pct 60 :compaction true :timestamp "2026-01-01T00:00:10Z"})
              (valid-event {:context_utilization_pct 90 :compaction false :timestamp "2026-01-01T00:00:20Z"})]
      summary (context-telemetry-lib/summarize events)]
  (assert= "summarize counts events" 3 (:event_count summary))
  (assert= "summarize counts compactions" 1 (:compaction_count summary))
  (assert= "summarize averages context utilisation across all events" 60.0 (:avg_context_utilization_pct summary)))

;; ── summarize: time-to-first-compaction-02 ────────────────────────────────
(let [events [(valid-event {:compaction false :timestamp "2026-01-01T00:00:00Z"})
              (valid-event {:compaction true :timestamp "2026-01-01T00:00:05Z"})]
      summary (context-telemetry-lib/summarize events)]
  (assert= "summarize reports the elapsed time between the first event and the first compaction"
           5000 (:time_to_first_compaction_ms summary)))

(let [events [(valid-event {:compaction false :timestamp "2026-01-01T00:00:00Z"})]
      summary (context-telemetry-lib/summarize events)]
  (assert-true "summarize reports a nil time-to-first-compaction when no event ever compacted"
               (nil? (:time_to_first_compaction_ms summary))))

(let [events [(valid-event {:compaction true :timestamp "2026-01-01T00:00:05Z"})
              (valid-event {:compaction false :timestamp "2026-01-01T00:00:00Z"})]
      summary (context-telemetry-lib/summarize events)]
  (assert= "summarize sorts events by timestamp before computing elapsed time, regardless of input order"
           5000 (:time_to_first_compaction_ms summary)))

(let [summary (context-telemetry-lib/summarize [])]
  (assert= "summarize on an empty event collection reports a zero event count" 0 (:event_count summary))
  (assert-true "summarize on an empty event collection reports a nil average utilisation"
               (nil? (:avg_context_utilization_pct summary)))
  (assert-true "summarize on an empty event collection reports a nil time-to-first-compaction"
               (nil? (:time_to_first_compaction_ms summary))))

;; ── summarize: latest_* snapshot fields (GH-23 dashboard display pin) ───
(let [events [(valid-event {:timestamp "2026-01-01T00:00:00Z" :provider "anthropic" :model "claude-sonnet-5"
                             :input_tokens 100 :output_tokens 10 :tool_output_tokens 1
                             :prompt_engine_tokens 2 :system_prompt_tokens 3 :history_tokens 4
                             :estimated_cost_usd 0.01})
              (valid-event {:timestamp "2026-01-01T00:00:10Z" :provider "openrouter" :model "claude-haiku-4.5"
                             :input_tokens 200 :output_tokens 20 :tool_output_tokens 5
                             :prompt_engine_tokens 6 :system_prompt_tokens 7 :history_tokens 8
                             :estimated_cost_usd 0.02})]
      summary (context-telemetry-lib/summarize events)]
  (assert= "summarize reports provider from the most recent event" "openrouter" (:provider summary))
  (assert= "summarize reports model from the most recent event" "claude-haiku-4.5" (:model summary))
  (assert= "summarize reports latest_input_tokens from the most recent event" 200 (:latest_input_tokens summary))
  (assert= "summarize reports latest_output_tokens from the most recent event" 20 (:latest_output_tokens summary))
  (assert= "summarize reports latest_tool_output_tokens from the most recent event" 5 (:latest_tool_output_tokens summary))
  (assert= "summarize reports latest_prompt_engine_tokens from the most recent event" 6 (:latest_prompt_engine_tokens summary))
  (assert= "summarize reports latest_system_prompt_tokens from the most recent event" 7 (:latest_system_prompt_tokens summary))
  (assert= "summarize reports latest_history_tokens from the most recent event" 8 (:latest_history_tokens summary))
  (assert= "summarize reports latest_estimated_cost_usd from the most recent event" 0.02 (:latest_estimated_cost_usd summary)))

(let [summary (context-telemetry-lib/summarize [])]
  (assert-true "summarize on an empty event collection reports a nil provider" (nil? (:provider summary)))
  (assert-true "summarize on an empty event collection reports a nil latest_input_tokens"
               (nil? (:latest_input_tokens summary))))

;; ── distinct-agents ───────────────────────────────────────────────────────
(assert= "distinct-agents sorts and dedupes agent names across events"
         ["coder" "hardener"]
         (context-telemetry-lib/distinct-agents
          [(valid-event {:agent "hardener"}) (valid-event {:agent "coder"}) (valid-event {:agent "coder"})]))

(assert= "distinct-agents on an empty event collection returns an empty vector"
         []
         (context-telemetry-lib/distinct-agents []))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
