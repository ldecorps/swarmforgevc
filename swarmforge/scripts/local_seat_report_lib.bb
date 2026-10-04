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
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; ── qwen usage (token-usage-<yyyy-mm>.jsonl): one row per request ──────────

(defn parse-usage-entries
  "file-contents: a coll of raw jsonl strings (one per token-usage-*.jsonl
   file). Returns every parseable {:session-id :input-tokens :output-tokens
   :thoughts-tokens :timestamp :model} row across all of them, blank lines and
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
                    :timestamp (:timestamp row)
                    :model (:model row)})
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

(defn- ui-event [row]
  (get-in row [:systemPayload :uiEvent]))

(defn- ui-event-name [row]
  (get (ui-event row) (keyword "event.name")))

(defn parse-session-events
  "chat-jsonl: the raw jsonl string of a session's own chat file (may be
   nil/blank when the file does not exist - never read here, only parsed).
   Returns {:turns (non-\"system\" rows - the actual conversation turns,
   distinct from :requests, a count of qwen usage/telemetry rows, which
   can outnumber turns on a retry) :compressions [{:tokens-before
   :tokens-after :timestamp} ...] :api-errors N :api-responses [{:timestamp
   :ttft-ms :duration-ms :input-tokens :output-tokens :thinking-tokens} ...]
   :tool-calls [{:timestamp :function-name :success?} ...]}.

   BL-1851 bounce-lesson fix: a chat_compression row's own token counts
   live at systemPayload.info.originalTokenCount/newTokenCount, never a
   top-level tokensBefore/tokensAfter (no real record has ever carried
   that shape - verified against every chat_compression row in every
   session file on this host: tokensBefore absent in 100% of them,
   originalTokenCount present in 100%). An API error is its own ui_event
   (qwen-code.api_error), never an apiError:true flag on an api_response
   row (no real record carries that flag either). Both wrong field reads
   always silently returned nil/0 - local_seat_report_cli.bb has been
   printing 'Compressions: N (->, ->, ...)' with no real numbers since
   BL-1842 shipped. :api-responses/:tool-calls are new (BL-1851 needs
   per-request timing/tool-outcome data BL-1842 never exposed) - reading
   them here, in the one pass this file already makes over the same
   rows, is what BL-1811 and this ticket's own 'do not write a second
   parser for the same records' direction ask for."
  [chat-jsonl]
  (let [all-rows (->> (str/split-lines (str chat-jsonl))
                       (remove str/blank?)
                       (keep (fn [line] (try (json/parse-string line true) (catch Exception _ nil)))))
        system-rows (filter #(= "system" (:type %)) all-rows)
        turns (count (remove #(= "system" (:type %)) all-rows))
        telemetry-rows (filter #(= "ui_telemetry" (:subtype %)) system-rows)
        compressions (->> system-rows
                          (filter #(= "chat_compression" (:subtype %)))
                          (map (fn [row]
                                 (let [info (get-in row [:systemPayload :info])]
                                   {:tokens-before (:originalTokenCount info)
                                    :tokens-after (:newTokenCount info)
                                    :timestamp (:timestamp row)}))))
        api-errors (count (filter #(= "qwen-code.api_error" (ui-event-name %)) telemetry-rows))
        api-responses (->> telemetry-rows
                           (filter #(= "qwen-code.api_response" (ui-event-name %)))
                           (map (fn [row]
                                  (let [e (ui-event row)]
                                    {:timestamp (:timestamp row)
                                     :ttft-ms (:ttft_ms e)
                                     :duration-ms (:duration_ms e)
                                     :input-tokens (:input_token_count e)
                                     :output-tokens (:output_token_count e)
                                     :thinking-tokens (:thoughts_token_count e)}))))
        tool-calls (->> telemetry-rows
                        (filter #(= "qwen-code.tool_call" (ui-event-name %)))
                        (map (fn [row]
                               (let [e (ui-event row)]
                                 {:timestamp (:timestamp row)
                                  :function-name (:function_name e)
                                  :success? (true? (:success e))}))))]
    {:turns turns
     :compressions (vec compressions)
     :api-errors api-errors
     :api-responses (vec api-responses)
     :tool-calls (vec tool-calls)}))

;; ── Ollama server log: how the model is served, and whether it is live ─────

(defn- mtime-ms
  "A file's last-modified time as epoch ms, or nil when it does not exist
   (a report never crashes on a missing log - the caller falls back to
   existence, not to an exception)."
  [path]
  (when (fs/exists? path) (fs/file-time->millis (fs/last-modified-time path))))

(defn default-ollama-log
  "The Ollama server log to read for a seat's worktree: the seat's own
   swarm log (<project-root>/.swarmforge/ollama/serve.log) when it exists,
   otherwise the operator's log (<project-root>/.swarmforge/ollama-serve-operator.log)
   when that exists, otherwise nil. When BOTH exist, the one with the
   NEWER mtime wins - a seat that switched to its own swarm log keeps
   reading it even though the operator log is still on disk, and a seat
   that has not started its own server yet still gets the operator log
   that was actually serving it. (BL-1851 bounce-lesson fix: this used to
   live private in local_seat_report_cli.bb, so the tuning report CLI
   could not reuse it and hardcoded the operator path instead - the
   ticket's own 'one parser, reuse the BL-1842 lib' direction.)"
  [project-root]
  (let [swarm (str (fs/path project-root ".swarmforge" "ollama" "serve.log"))
        operator (str (fs/path project-root ".swarmforge" "ollama-serve-operator.log"))
        swarm-ms (mtime-ms swarm)
        operator-ms (mtime-ms operator)]
    (cond
      (and swarm-ms operator-ms) (if (>= swarm-ms operator-ms) swarm operator)
      swarm-ms swarm
      operator-ms operator
      :else nil)))

(defn- parse-log-offset-ms
  "An Ollama server-log timestamp (time=2026-10-03T13:27:39.128+01:00,
   OffsetDateTime shape - never Instant/parse, which rejects a non-Z
   offset outright) to epoch ms, or nil on any parse failure."
  [ts]
  (try (.toEpochMilli (.toInstant (java.time.OffsetDateTime/parse ts))) (catch Exception _ nil)))

(defn- load-segment-facts
  "The same layers/kv-cache-type reading parse-ollama-load does, scoped to
   one segment's own text - the segment's LAST match, mirroring that
   function's own 'later supersedes earlier' rule at the segment level
   (llama.cpp sometimes logs offload progress more than once per load)."
  [segment-text]
  (let [layers (last (re-seq #"load_tensors: offloaded (\d+)/(\d+) layers to GPU" segment-text))
        kv (last (re-seq #"llama_kv_cache:.*\(([a-z0-9_]+)\)" segment-text))]
    {:layers-on-gpu (when layers (Long/parseLong (second layers)))
     :layers-total (when layers (Long/parseLong (nth layers 2)))
     :kv-cache-type (when kv (second kv))}))

(defn parse-ollama-loads
  "BL-1851: every model load over the log's lifetime, oldest first - a
   seat's server log can carry several (a restart, a settings change
   applied by relaunching). llama-server itself runs with
   --no-log-timestamps (its own load_tensors:/llama_kv_cache: lines carry
   no timestamp at all - confirmed against a live log), but Ollama's own
   wrapper logs a timestamped 'starting llama-server' line immediately
   before each one starts, which is what anchors a load in time here.
   Each load's own facts are read from the text between its own
   'starting llama-server' line and the next one (or EOF for the last) -
   never from the whole log, which would let an EARLIER load's own
   offload line leak into a LATER load's facts.

   {:at-ms :layers-on-gpu :layers-total :kv-cache-type} per load. A
   segment with no load_tensors line of its own (started but never
   finished loading, e.g. a discovery timeout) is dropped - it never
   actually served a request, so it is not a load this function reports."
  [log-text]
  (let [text (str log-text)
        marker #"(?m)^time=(\S+).*msg=\"starting llama-server\""
        matcher (re-matcher marker text)
        starts (loop [acc []]
                 (if (.find matcher)
                   (recur (conj acc [(.start matcher) (.group matcher 1)]))
                   acc))
        bounds (map vector starts (concat (rest (map first starts)) [(count text)]))]
    (->> bounds
         (keep (fn [[[start ts] end]]
                 (let [at-ms (parse-log-offset-ms ts)
                       segment (subs text start end)
                       facts (load-segment-facts segment)]
                   (when (and at-ms (:layers-on-gpu facts))
                     (assoc facts :at-ms at-ms)))))
         vec)))

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
