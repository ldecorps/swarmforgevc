;; BL-1842: pure parsing and summarising for a local-model seat's health
;; report. The coordinator misread coder@iq3 as stuck on 2026-09-30 (CPU
;; near 0%, the same pane lines, no commits) when it was in fact generating
;; at 3.5 tokens/s with 8 of 65 layers offloaded to CPU, then later
;; compressing its chat every turn - every one of those facts was already
;; on disk, in qwen's own usage/session records and the Ollama server log.
;; This file turns those three record shapes into one summary; the CLI
;; (local_seat_report_cli.bb) is the only IO - reading files, resolving
;; default paths, checking whether a seat's process is alive - so every
;; function here is a pure function of already-read strings/data (BL-1811:
;; IO-near code calls the module that owns the domain answer, here the
;; other way around - the domain answer lives here, IO stays at the edge).
(ns local-seat-report-lib
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

;; ── qwen usage (token-usage-<yyyy-mm>.jsonl): one row per request ──────────

(defn parse-usage-entries
  "file-contents: a coll of raw jsonl strings (one per token-usage-*.jsonl
   file). Returns every parseable {:session-id :input-tokens :output-tokens
   :thoughts-tokens :timestamp} row across all of them, blank lines and
   unparseable rows dropped rather than throwing (BL-1842: a report never
   crashes on a malformed line it merely wants to skip)."
  [file-contents]
  (->> file-contents
       (mapcat str/split-lines)
       (remove str/blank?)
       (keep (fn [line]
               (try
                 (let [row (json/parse-string line true)]
                   {:session-id (:sessionId row)
                    :input-tokens (or (:inputTokens row) 0)
                    :output-tokens (or (:outputTokens row) 0)
                    :thoughts-tokens (or (:thoughtsTokens row) 0)
                    :timestamp (:timestamp row)})
                 (catch Exception _ nil))))
       (remove #(str/blank? (:session-id %)))))

(defn latest-session-id
  "The sessionId of the usage entry with the latest :timestamp (ISO-8601
   strings sort lexically the same as chronologically), or nil when there
   are no entries."
  [usage-entries]
  (->> usage-entries
       (remove #(str/blank? (:timestamp %)))
       (sort-by :timestamp)
       last
       :session-id))

(defn recent-session-ids
  "The n most recent distinct session ids, newest first, each ranked by
   its own latest :timestamp (a session's rows are not necessarily
   contiguous, so this groups by session-id before ranking rather than
   just taking the last n rows' session ids)."
  [usage-entries n]
  (->> usage-entries
       (remove #(str/blank? (:timestamp %)))
       (group-by :session-id)
       (map (fn [[session-id rows]] [session-id (last (sort (map :timestamp rows)))]))
       (sort-by second)
       reverse
       (take n)
       (map first)))

(defn session-usage-summary
  "requests (row count), total output and reasoning (thoughts) tokens, and
   the longest single request (max input+output tokens over one row) - the
   ticket's own \"total output and reasoning tokens, and the longest
   request\" - for just session-id's own rows. 0 for every field when the
   session has no rows."
  [usage-entries session-id]
  (let [rows (filter #(= session-id (:session-id %)) usage-entries)]
    {:requests (count rows)
     :output-tokens (reduce + 0 (map :output-tokens rows))
     :reasoning-tokens (reduce + 0 (map :thoughts-tokens rows))
     :longest-request-tokens (if (seq rows)
                                (apply max (map #(+ (:input-tokens %) (:output-tokens %)) rows))
                                0)}))

;; ── qwen session chat file: "system" rows for compressions/api errors ──────

(defn parse-session-events
  "chat-jsonl: the raw jsonl string of a session's own chat file (may be
   nil/blank when the file does not exist - never read here, only parsed).
   Returns {:turns (non-\"system\" rows - the actual conversation turns,
   distinct from :requests, a count of qwen usage/telemetry rows, which
   can outnumber turns on a retry) :compressions [{:tokens-before
   :tokens-after} ...] :api-errors N}."
  [chat-jsonl]
  (let [all-rows (->> (str/split-lines (str chat-jsonl))
                       (remove str/blank?)
                       (keep (fn [line] (try (json/parse-string line true) (catch Exception _ nil)))))
        system-rows (filter #(= "system" (:type %)) all-rows)
        turns (count (remove #(= "system" (:type %)) all-rows))
        compressions (->> system-rows
                          (filter #(= "chat_compression" (:subtype %)))
                          (map (fn [row] {:tokens-before (:tokensBefore row) :tokens-after (:tokensAfter row)})))
        api-errors (count (filter #(and (= "ui_telemetry" (:subtype %)) (true? (:apiError %))) system-rows))]
    {:turns turns
     :compressions (vec compressions)
     :api-errors api-errors}))

;; ── Ollama server log: how the model is served, and whether it is live ─────

(defn parse-ollama-load
  "The LATEST load line-group in the server log (later loads, e.g. after a
   restart, supersede earlier ones - `last` on each regex's matches).
   {:layers-on-gpu :layers-total :context :kv-cache-type :tokens-per-second},
   any key nil when its line is absent."
  [log-text]
  (let [text (str log-text)
        layers (last (re-seq #"load_tensors: offloaded (\d+)/(\d+) layers to GPU" text))
        kv (last (re-seq #"llama_kv_cache:.*\(([a-z0-9_]+)\)" text))
        ctx (last (re-seq #"llama_context:\s*n_ctx\s*=\s*(\d+)" text))
        tg (last (re-seq #"tg = ([0-9.]+) t/s" text))]
    {:layers-on-gpu (when layers (Long/parseLong (second layers)))
     :layers-total (when layers (Long/parseLong (nth layers 2)))
     :context (when ctx (Long/parseLong (second ctx)))
     :kv-cache-type (when kv (second kv))
     :tokens-per-second (when tg (Double/parseDouble (second tg)))}))

(def generating-within-ms
  "A generation-in-progress log line this recent means the seat is still
   working the request, not stuck (the misdiagnosis this ticket exists to
   prevent) - one minute, the same freshness the ticket's own scenario 03
   uses."
  60000)

(defn latest-generating-at-ms
  "The MAX epoch-ms timestamp among every `<iso> slot process: generating`
   line in the log (by value, never by line order - a log is not
   guaranteed chronological, e.g. after a restart appends an older-looking
   retry), or nil when there is none. Malformed timestamps are skipped
   rather than thrown (a report never crashes reading a log line it cannot
   parse)."
  [log-text]
  (let [timestamps (->> (re-seq #"(?m)^(\S+)\s+slot process: generating" (str log-text))
                         (keep (fn [[_ ts]]
                                 (try (.toEpochMilli (java.time.Instant/parse ts)) (catch Exception _ nil)))))]
    (when (seq timestamps) (apply max timestamps))))

(defn seat-state
  "generating: a generating log line within generating-within-ms of now-ms.
   down: no generating line that recent AND process-alive? is false.
   idle: otherwise (not generating, but the seat's own process is up)."
  [{:keys [now-ms generating-at-ms process-alive?]}]
  (cond
    (and generating-at-ms (<= (- now-ms generating-at-ms) generating-within-ms)) :generating
    (not process-alive?) :down
    :else :idle))

;; ── seat -> worktree -> qwen project key ────────────────────────────────────

(defn seat-worktree-path
  "coder@iq3 -> <project-root>/.worktrees/coder-iq3; coder (no @variant) ->
   <project-root>/.worktrees/coder - the same worktree-per-seat layout
   PIPELINE.md's role table and the local-model packs already use."
  [project-root seat]
  (str project-root "/.worktrees/" (str/replace seat "@" "-")))

(defn qwen-cwd-key
  "qwen's own project-directory naming: every '/' and '.' in an absolute
   path becomes '-' (e.g. /home/t/.worktrees/coder-iq3 ->
   -home-t--worktrees-coder-iq3 - the same scheme this session's own
   scratchpad directory name already follows)."
  [path]
  (str/replace path #"[/.]" "-"))

(defn summarise
  "The whole report as data, never printed here (the CLI owns rendering -
   this function has no *out* dependency so it is trivially testable).
   usage-entries: parse-usage-entries' output for every usage file found.
   session-id: which session to summarise - defaults to the latest when
   omitted (the CLI's --sessions N loops this over recent-session-ids).
   chat-jsonl: the resolved session file's raw content, or nil.
   ollama-log-text: the resolved server log's raw content, or nil.
   now-ms/process-alive?: seat-state's own inputs."
  [{:keys [usage-entries session-id chat-jsonl ollama-log-text now-ms process-alive?]}]
  (let [session-id (or session-id (latest-session-id usage-entries))
        usage (session-usage-summary usage-entries session-id)
        events (parse-session-events chat-jsonl)
        served (parse-ollama-load ollama-log-text)
        generating-at (latest-generating-at-ms ollama-log-text)
        state (seat-state {:now-ms now-ms :generating-at-ms generating-at :process-alive? process-alive?})]
    {:session-id session-id
     :requests (:requests usage)
     :turns (:turns events)
     :output-tokens (:output-tokens usage)
     :reasoning-tokens (:reasoning-tokens usage)
     :longest-request-tokens (:longest-request-tokens usage)
     :compressions (:compressions events)
     :api-errors (:api-errors events)
     :served served
     :state state}))
