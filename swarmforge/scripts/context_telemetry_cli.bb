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
;;   context_telemetry_cli.bb agents
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
  (println "  record-batch  (reads one JSON event object per line on stdin)")
  (println "  summary --agent A [--session-id S]")
  (println "  agents")
  (System/exit 1))

(defn run-record [rest-args]
  (let [event (args->event rest-args)
        {:keys [valid? error]} (context-telemetry-lib/validate-event event)]
    (if-not valid?
      (do (binding [*out* *err*] (println error))
          (System/exit 1))
      (do (context-telemetry-store/append-event! (state-dir) (context-telemetry-lib/normalize-event event))
          (println (str "recorded " (:agent event) " " (:session_id event) " " (:timestamp event)))))))

;; BL-1477: one subprocess per producer TICK, not one per event - ~200000
;; events backlogged behind the torn-tail defect at ~0.3s of bb start-up
;; each is a day of subprocess time, five times the 60s wait bound every
;; cycle. Reads one JSON event object per line from stdin, validates EVERY
;; line first (never partially appends a batch some prefix of which turned
;; out invalid), then appends all of them in one store call.
(defn- read-stdin-event-lines []
  (->> (line-seq (java.io.BufferedReader. *in*))
       (remove str/blank?)))

(defn run-record-batch []
  (let [lines (read-stdin-event-lines)
        parsed (mapv (fn [l]
                       (try {:ok true :event (json/parse-string l true)}
                            (catch Exception _ {:ok false :line l})))
                     lines)]
    (if-let [bad (first (remove :ok parsed))]
      (do (binding [*out* *err*] (println (str "record-batch: unparseable input line: " (:line bad))))
          (System/exit 1))
      (let [events (mapv :event parsed)
            invalid (some (fn [e] (let [v (context-telemetry-lib/validate-event e)]
                                     (when-not (:valid? v) (:error v))))
                          events)]
        (if invalid
          (do (binding [*out* *err*] (println invalid))
              (System/exit 1))
          (let [normalized (mapv context-telemetry-lib/normalize-event events)]
            (context-telemetry-store/append-events! (state-dir) normalized)
            (println (str "recorded " (count normalized)))))))))

;; BL-1477: interior damage (an unparseable line with a whole line after it)
;; makes read-events-report! throw rather than answer - the store is the
;; dedupe cursor, and recording or summarizing against one that cannot be
;; read would duplicate or silently under-report. Every reading command
;; refuses the same way: named on stderr, exit non-zero, nothing else printed.
(defn- read-events-report-or-exit! []
  (try
    (context-telemetry-store/read-events-report! (state-dir))
    (catch Exception e
      (binding [*out* *err*] (println (.getMessage e)))
      (System/exit 1))))

(defn- report-torn-tail! [torn-tail-line]
  (when torn-tail-line
    (binding [*out* *err*]
      (println (str "context-events store: torn tail dropped at line " torn-tail-line)))))

(defn run-summary [rest-args]
  (let [agent (opt-value rest-args "--agent")
        session-id (opt-value rest-args "--session-id")
        {:keys [events torn-tail-line]} (read-events-report-or-exit!)
        scoped (cond->> events
                 agent (filter #(= agent (:agent %)))
                 session-id (filter #(= session-id (:session_id %))))
        summary (context-telemetry-lib/summarize scoped)]
    (report-torn-tail! torn-tail-line)
    (println (json/generate-string (assoc summary :agent agent :session_id session-id)))))

(defn run-agents []
  (let [{:keys [events torn-tail-line]} (read-events-report-or-exit!)]
    (report-torn-tail! torn-tail-line)
    (println (json/generate-string {:agents (context-telemetry-lib/distinct-agents events)}))))

(let [args (cli-args)
      cmd (first args)
      rest-args (vec (rest args))]
  (case cmd
    "record" (run-record rest-args)
    "record-batch" (run-record-batch)
    "summary" (run-summary rest-args)
    "agents" (run-agents)
    (usage)))
