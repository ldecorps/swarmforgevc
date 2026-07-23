#!/usr/bin/env bb
;; Context Telemetry CLI (GH-22 Slice 1) — the shell entry point over the
;; append-only invocation-event log. Thin: all decisions live in
;; context_telemetry_lib.bb, all disk IO in context_telemetry_store.bb.
;; This ticket is the recorder + query CLI only — no live capture wiring at
;; real agent-invocation call sites (that is Slice 2, a separate ticket).
;;
;; Usage:
;;   context_telemetry_cli.bb record --agent A --role R --session-id S --timestamp T
;;     --input-tokens N --output-tokens N --context-utilization-pct N --provider P --model M
;;     [--tool-output-tokens N] [--prompt-engine-tokens N] [--system-prompt-tokens N]
;;     [--history-tokens N] [--compaction true|false] [--estimated-cost-usd N]
;;   context_telemetry_cli.bb summary --agent A [--session-id S]
(ns context-telemetry-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "context_telemetry_store.bb")))
(load-file (str (fs/path scripts-dir "context_telemetry_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn state-dir
  "Runtime state root. Overridable via CONTEXT_TELEMETRY_STATE_DIR so
   acceptance and shell tests can point the CLI at an isolated temp dir
   instead of mutating this repo's real .swarmforge/telemetry/ on every
   run."
  []
  (or (System/getenv "CONTEXT_TELEMETRY_STATE_DIR")
      (str (fs/path (context-telemetry-store/repo-root) context-telemetry-store/default-state-dir-rel))))

(defn opt-value
  "Returns the value following flag `k` in `args`, or nil if absent. `args`
   may be any seq — .indexOf is a java.util.List method, not a Collection
   one, so a lazy seq (e.g. from `rest`) must be coerced to a vector first."
  [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (and (>= idx 0) (< (inc idx) (count args)))
      (nth args (inc idx)))))

(def flag->field
  {"--agent" :agent
   "--role" :role
   "--session-id" :session_id
   "--timestamp" :timestamp
   "--input-tokens" :input_tokens
   "--output-tokens" :output_tokens
   "--tool-output-tokens" :tool_output_tokens
   "--prompt-engine-tokens" :prompt_engine_tokens
   "--system-prompt-tokens" :system_prompt_tokens
   "--history-tokens" :history_tokens
   "--context-utilization-pct" :context_utilization_pct
   "--provider" :provider
   "--model" :model
   "--estimated-cost-usd" :estimated_cost_usd})

(defn args->event
  "Builds an event map straight from argv flags — every value arrives as a
   raw string (or absent), exactly as the CLI received it. validate-event
   decides what is acceptable; this function makes no judgment calls.
   --compaction defaults to \"false\" when omitted, which is what lets a
   caller record a non-compaction event without naming the flag at all."
  [args]
  (reduce (fn [event [flag field]]
            (if-let [v (opt-value args flag)]
              (assoc event field v)
              event))
          {:compaction (or (opt-value args "--compaction") "false")}
          flag->field))

(defn usage []
  (println "Usage: context_telemetry_cli.bb <command> [args...]")
  (println "Commands:")
  (println "  record --agent A --role R --session-id S --timestamp T --input-tokens N --output-tokens N --context-utilization-pct N --provider P --model M [--tool-output-tokens N] [--prompt-engine-tokens N] [--system-prompt-tokens N] [--history-tokens N] [--compaction true|false] [--estimated-cost-usd N]")
  (println "  summary --agent A [--session-id S]")
  (System/exit 1))

(defn run-record [rest-args]
  (let [event (args->event rest-args)
        {:keys [valid? error]} (context-telemetry-lib/validate-event event)]
    (if-not valid?
      (do (binding [*out* *err*] (println error))
          (System/exit 1))
      (do (context-telemetry-store/append-event! (state-dir) (context-telemetry-lib/normalize-event event))
          (println (str "recorded " (:agent event) " " (:session_id event) " " (:timestamp event)))))))

(defn run-summary [rest-args]
  (let [agent (opt-value rest-args "--agent")
        session-id (opt-value rest-args "--session-id")
        events (context-telemetry-store/read-events! (state-dir))
        scoped (cond->> events
                 agent (filter #(= agent (:agent %)))
                 session-id (filter #(= session-id (:session_id %))))
        summary (context-telemetry-lib/summarize scoped)]
    (println (json/generate-string (assoc summary :agent agent :session_id session-id)))))

(let [args (cli-args)
      cmd (first args)
      rest-args (vec (rest args))]
  (case cmd
    "record" (run-record rest-args)
    "summary" (run-summary rest-args)
    (usage)))
