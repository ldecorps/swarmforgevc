#!/usr/bin/env bb
;; BL-1842: TDD runner for local_seat_report_lib.bb's pure parsing/summary
;; functions. The CLI's own IO (default path resolution, reading files,
;; checking whether a seat's process is alive) is covered by the acceptance
;; feature's step handler over a real mkdtemp fixture; this file is the
;; parsing and decision logic alone.
(ns local-seat-report-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "local_seat_report_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; ── parse-usage-entries / latest-session-id / session-usage-summary ────────

;; BL-1848: the babysitter's window check judges each request against the
;; window of the model that served it, so the reader keeps the row's model.
(assert= "BL-1848: parse-usage-entries keeps each row's model"
         ["qwen2.5-coder-14b-q5km:latest" nil]
         (mapv :model (local-seat-report-lib/parse-usage-entries
                       [(str "{\"model\":\"qwen2.5-coder-14b-q5km:latest\",\"sessionId\":\"S1\",\"inputTokens\":5630,\"outputTokens\":976,\"timestamp\":\"2026-10-02T23:41:08.169Z\"}\n"
                             "{\"sessionId\":\"S2\",\"inputTokens\":1,\"outputTokens\":1,\"timestamp\":\"2026-10-02T23:42:00Z\"}\n")])))

(defn usage-line [session-id in out thoughts ts]
  (str "{\"sessionId\":\"" session-id "\",\"inputTokens\":" in
       ",\"outputTokens\":" out ",\"thoughtsTokens\":" thoughts
       ",\"timestamp\":\"" ts "\"}"))

(let [file1 (str (usage-line "S1" 10 5 1 "2026-09-30T10:00:00Z") "\n"
                  (usage-line "S1" 10 5 1 "2026-09-30T10:01:00Z") "\n")
      file2 (str (usage-line "S2" 20 8 2 "2026-09-30T11:00:00Z") "\n"
                  ""  ;; a blank line must never throw or count
                  "\n"
                  "not json\n"  ;; unparseable rows are dropped, not thrown
                  (usage-line "S2" 20 8 2 "2026-09-30T11:02:00Z") "\n"
                  (usage-line "S2" 20 8 2 "2026-09-30T11:04:00Z") "\n")
      entries (local-seat-report-lib/parse-usage-entries [file1 file2])]
  (assert= "parse-usage-entries drops blank/unparseable rows, keeps 5 real ones" 5 (count entries))
  (assert= "latest-session-id picks the row with the latest timestamp (S2, not S1)"
           "S2" (local-seat-report-lib/latest-session-id entries))
  (let [summary (local-seat-report-lib/session-usage-summary entries "S2")]
    (assert= "session-usage-summary counts only S2's own 3 rows as requests" 3 (:requests summary))
    (assert= "session-usage-summary sums S2's own output tokens" 24 (:output-tokens summary))
    (assert= "session-usage-summary sums S2's own reasoning tokens" 6 (:reasoning-tokens summary))))

;; ── recent-session-ids ──────────────────────────────────────────────────────

(let [entries (local-seat-report-lib/parse-usage-entries
               [(str (usage-line "S1" 1 1 1 "2026-09-30T10:00:00Z") "\n"
                     (usage-line "S2" 1 1 1 "2026-09-30T11:00:00Z") "\n"
                     (usage-line "S1" 1 1 1 "2026-09-30T10:05:00Z") "\n"
                     (usage-line "S3" 1 1 1 "2026-09-30T12:00:00Z") "\n")])]
  (assert= "recent-session-ids ranks by each session's OWN latest row, newest first"
           ["S3" "S2" "S1"] (local-seat-report-lib/recent-session-ids entries 3))
  (assert= "recent-session-ids --sessions 2 takes only the top 2"
           ["S3" "S2"] (local-seat-report-lib/recent-session-ids entries 2)))
(assert= "recent-session-ids on no entries is empty" [] (local-seat-report-lib/recent-session-ids [] 5))

(assert= "latest-session-id is nil with no entries" nil (local-seat-report-lib/latest-session-id []))
(assert= "session-usage-summary is all-zero for an unknown session id"
         {:requests 0 :output-tokens 0 :reasoning-tokens 0 :longest-request-tokens 0}
         (local-seat-report-lib/session-usage-summary [] "unknown"))

(let [entries (local-seat-report-lib/parse-usage-entries
               [(str (usage-line "S1" 100 20 5 "2026-09-30T10:00:00Z") "\n"
                     ;; the biggest single request: 900 input + 300 output = 1200
                     (usage-line "S1" 900 300 50 "2026-09-30T10:01:00Z") "\n"
                     (usage-line "S1" 50 10 2 "2026-09-30T10:02:00Z") "\n")])]
  (assert= "session-usage-summary's longest-request-tokens is the MAX single row's input+output, not the sum"
           1200 (:longest-request-tokens (local-seat-report-lib/session-usage-summary entries "S1"))))

;; ── parse-session-events ────────────────────────────────────────────────────
;; BL-1851 bounce-lesson fix (2026-10-03): every fixture below is the REAL
;; qwen record shape (verified against live session files on this host -
;; systemPayload.info.*/systemPayload.uiEvent.* nesting), never the
;; idealized top-level tokensBefore/apiError shape the old fixture (and the
;; old, silently-always-nil code) both used.

(defn- compression-row [before after ts]
  (json/generate-string {:type "system" :subtype "chat_compression" :timestamp ts
                          :systemPayload {:info {:originalTokenCount before :newTokenCount after}}}))

(defn- api-response-row [ts ttft duration in out thinking]
  (json/generate-string {:type "system" :subtype "ui_telemetry" :timestamp ts
                          :systemPayload {:uiEvent {(keyword "event.name") "qwen-code.api_response"
                                                     :ttft_ms ttft :duration_ms duration
                                                     :input_token_count in :output_token_count out
                                                     :thoughts_token_count thinking}}}))

(defn- api-error-row [ts]
  (json/generate-string {:type "system" :subtype "ui_telemetry" :timestamp ts
                          :systemPayload {:uiEvent {(keyword "event.name") "qwen-code.api_error"}}}))

(defn- tool-call-row [ts fn-name success?]
  (json/generate-string {:type "system" :subtype "ui_telemetry" :timestamp ts
                          :systemPayload {:uiEvent {(keyword "event.name") "qwen-code.tool_call"
                                                     :function_name fn-name :success success?}}}))

(let [chat (str "{\"type\":\"user\",\"text\":\"hi\"}\n"
                "{\"type\":\"assistant\",\"text\":\"hello\"}\n"
                (compression-row 9000 1200 "2026-10-03T00:00:00.000Z") "\n"
                (compression-row 9500 1300 "2026-10-03T00:01:00.000Z") "\n"
                (api-error-row "2026-10-03T00:02:00.000Z") "\n"
                (api-response-row "2026-10-03T00:03:00.000Z" 500 2000 1000 50 10) "\n"
                (tool-call-row "2026-10-03T00:04:00.000Z" "read_file" false) "\n"
                (tool-call-row "2026-10-03T00:05:00.000Z" "run_shell_command" true) "\n")
      events (local-seat-report-lib/parse-session-events chat)]
  (assert= "parse-session-events counts exactly 2 chat_compression rows" 2 (count (:compressions events)))
  (assert= "parse-session-events reads a real compression row's before/after tokens from systemPayload.info, not a top-level field"
           {:tokens-before 9000 :tokens-after 1200 :timestamp "2026-10-03T00:00:00.000Z"}
           (first (:compressions events)))
  (assert= "parse-session-events counts a real qwen-code.api_error event, never an apiError:true flag (no real record ever carries one)"
           1 (:api-errors events))
  (assert= "parse-session-events counts non-system rows (user+assistant) as turns, never the system rows"
           2 (:turns events))
  (assert= "parse-session-events extracts a real api_response row's timing and token fields"
           {:timestamp "2026-10-03T00:03:00.000Z" :ttft-ms 500 :duration-ms 2000
            :input-tokens 1000 :output-tokens 50 :thinking-tokens 10}
           (first (:api-responses events)))
  (assert= "parse-session-events extracts every real tool_call row's function name and success flag"
           [{:timestamp "2026-10-03T00:04:00.000Z" :function-name "read_file" :success? false}
            {:timestamp "2026-10-03T00:05:00.000Z" :function-name "run_shell_command" :success? true}]
           (:tool-calls events)))

(assert= "parse-session-events on nil content is empty, never throws"
         {:turns 0 :compressions [] :api-errors 0 :api-responses [] :tool-calls []}
         (local-seat-report-lib/parse-session-events nil))

;; ── parse-ollama-load ───────────────────────────────────────────────────────

(let [log (str "load_tensors: offloaded 8/65 layers to GPU\n"
               "llama_kv_cache: size = 512.00 MiB (q8_0)\n"
               "llama_context: n_ctx      = 32768\n"
               "slot print_timing: prompt eval | tg = 3.50 t/s\n"
               ;; a later load supersedes the earlier one - `last` wins.
               "load_tensors: offloaded 57/65 layers to GPU\n"
               "llama_kv_cache: size = 4096.00 MiB (f16)\n"
               "llama_context: n_ctx      = 49152\n"
               "slot print_timing: prompt eval | tg = 12.10 t/s\n")
      served (local-seat-report-lib/parse-ollama-load log)]
  (assert= "parse-ollama-load reads the LATEST layers-on-gpu, not the first" 57 (:layers-on-gpu served))
  (assert= "parse-ollama-load reads the LATEST layers-total" 65 (:layers-total served))
  (assert= "parse-ollama-load reads the LATEST context" 49152 (:context served))
  (assert= "parse-ollama-load reads the LATEST kv-cache-type" "f16" (:kv-cache-type served))
  (assert= "parse-ollama-load reads the LATEST tokens-per-second" 12.10 (:tokens-per-second served)))

(assert= "parse-ollama-load on nil/blank text has every key nil"
         {:layers-on-gpu nil :layers-total nil :context nil :kv-cache-type nil :tokens-per-second nil}
         (local-seat-report-lib/parse-ollama-load nil))

;; ── latest-generating-at-ms / seat-state ────────────────────────────────────

(let [log "2026-09-30T22:04:30Z slot process: generating\n2026-09-30T22:04:00Z slot process: generating\n"]
  (assert= "latest-generating-at-ms picks the LATER of two generating lines"
           (.toEpochMilli (java.time.Instant/parse "2026-09-30T22:04:30Z"))
           (local-seat-report-lib/latest-generating-at-ms log)))
(assert= "latest-generating-at-ms is nil with no generating line" nil
         (local-seat-report-lib/latest-generating-at-ms "load_tensors: offloaded 8/65 layers to GPU\n"))

(let [now (.toEpochMilli (java.time.Instant/parse "2026-09-30T22:05:00Z"))]
  (assert= "seat-state: a generating line 30s ago -> generating"
           :generating
           (local-seat-report-lib/seat-state
            {:now-ms now
             :generating-at-ms (.toEpochMilli (java.time.Instant/parse "2026-09-30T22:04:30Z"))
             :process-alive? true}))
  (assert= "seat-state: a generating line over a minute ago, process alive -> idle, not generating"
           :idle
           (local-seat-report-lib/seat-state
            {:now-ms now
             :generating-at-ms (.toEpochMilli (java.time.Instant/parse "2026-09-30T22:03:00Z"))
             :process-alive? true}))
  (assert= "seat-state: no generating line, process alive -> idle"
           :idle
           (local-seat-report-lib/seat-state {:now-ms now :generating-at-ms nil :process-alive? true}))
  (assert= "seat-state: no generating line, process dead -> down"
           :down
           (local-seat-report-lib/seat-state {:now-ms now :generating-at-ms nil :process-alive? false}))
  (assert= "seat-state: a stale generating line AND a dead process -> down, never generating"
           :down
           (local-seat-report-lib/seat-state
            {:now-ms now
             :generating-at-ms (.toEpochMilli (java.time.Instant/parse "2026-09-30T22:00:00Z"))
             :process-alive? false}))
  ;; Hardener pass (2026-10-01): every existing case above sits well inside
  ;; or well outside generating-within-ms (30s / 120s), never AT it - a
  ;; mutant weakening the boundary's `<=` to `<` survived every one of them
  ;; (confirmed by hand-mutating and re-running: ALL PASS unchanged). Pinned
  ;; exactly at the boundary (now-ms - generating-at-ms = 60000, i.e. a
  ;; generating line generating-within-ms old) to require <=, not <.
  (assert= "seat-state: a generating line EXACTLY generating-within-ms old is still generating, not idle (<=, not <)"
           :generating
           (local-seat-report-lib/seat-state
            {:now-ms now
             :generating-at-ms (- now local-seat-report-lib/generating-within-ms)
             :process-alive? true})))

;; ── seat-worktree-path / qwen-cwd-key ───────────────────────────────────────

(assert= "seat-worktree-path joins root, .worktrees and the seat with @ turned to -"
         "/repo/.worktrees/coder-iq3" (local-seat-report-lib/seat-worktree-path "/repo" "coder@iq3"))
(assert= "seat-worktree-path with no @variant uses the bare role name"
         "/repo/.worktrees/coder" (local-seat-report-lib/seat-worktree-path "/repo" "coder"))
(assert= "qwen-cwd-key turns every / and . into -"
         "-home-t--worktrees-coder-iq3" (local-seat-report-lib/qwen-cwd-key "/home/t/.worktrees/coder-iq3"))

;; ── summarise (the whole report as data) ────────────────────────────────────

(let [usage-entries (local-seat-report-lib/parse-usage-entries
                      [(str (usage-line "S1" 100 50 20 "2026-09-30T22:00:00Z") "\n"
                            (usage-line "S1" 100 50 20 "2026-09-30T22:01:00Z") "\n"
                            (usage-line "S1" 100 60 25 "2026-09-30T22:02:00Z") "\n"
                            (usage-line "S1" 100 60 25 "2026-09-30T22:03:00Z") "\n"
                            (usage-line "S1" 100 60 25 "2026-09-30T22:04:00Z") "\n"
                            (usage-line "S1" 100 60 25 "2026-09-30T22:05:00Z") "\n")])
      chat (str (compression-row 9000 1200 "2026-09-30T22:00:30.000Z") "\n"
                (compression-row 9500 1300 "2026-09-30T22:01:30.000Z") "\n"
                (api-error-row "2026-09-30T22:02:30.000Z") "\n")
      log (str "load_tensors: offloaded 57/65 layers to GPU\n"
               "llama_kv_cache: size = 512.00 MiB (f16)\n"
               "llama_context: n_ctx      = 49152\n"
               "slot print_timing: prompt eval | tg = 3.50 t/s\n")
      report (local-seat-report-lib/summarise
              {:usage-entries usage-entries :chat-jsonl chat :ollama-log-text log
               :now-ms (.toEpochMilli (java.time.Instant/parse "2026-09-30T22:10:00Z"))
               :process-alive? true})]
  ;; BL-1842 scenario 01: 6 requests, 2 compressions, 1 api error.
  (assert= "summarise: session-id is the latest usage entry's session" "S1" (:session-id report))
  (assert= "summarise scenario 01: 6 requests" 6 (:requests report))
  (assert= "summarise scenario 01: total output tokens" 340 (:output-tokens report))
  (assert= "summarise scenario 01: total reasoning tokens" 140 (:reasoning-tokens report))
  (assert= "summarise: longest request is the MAX single row's input+output (100+60), not the sum"
           160 (:longest-request-tokens report))
  (assert= "summarise: turns counts the chat file's non-system rows (0 here - fixture is all system rows)"
           0 (:turns report))
  (assert= "summarise scenario 01: 2 compressions" 2 (count (:compressions report)))
  (assert= "summarise scenario 01: 1 api error" 1 (:api-errors report))
  ;; BL-1842 scenario 02: how the model is served.
  (assert= "summarise scenario 02: layers on GPU" 57 (get-in report [:served :layers-on-gpu]))
  (assert= "summarise scenario 02: layers total" 65 (get-in report [:served :layers-total]))
  (assert= "summarise scenario 02: context" 49152 (get-in report [:served :context]))
  (assert= "summarise scenario 02: kv cache type" "f16" (get-in report [:served :kv-cache-type]))
  (assert= "summarise scenario 02: tokens per second" 3.50 (get-in report [:served :tokens-per-second]))
  ;; no generating line in this fixture's log -> idle, process alive.
  (assert= "summarise: idle with no generating line and a live process" :idle (:state report)))

;; BL-1842 scenario 03: a generating line within the last minute -> generating,
;; even though the seat's last recorded request (the usage entries) is old.
(let [usage-entries (local-seat-report-lib/parse-usage-entries
                      [(str (usage-line "S1" 100 50 20 "2026-09-30T21:59:00Z") "\n")])
      log (str "load_tensors: offloaded 57/65 layers to GPU\n"
               "2026-09-30T22:04:30Z slot process: generating\n")
      report (local-seat-report-lib/summarise
              {:usage-entries usage-entries :chat-jsonl nil :ollama-log-text log
               :now-ms (.toEpochMilli (java.time.Instant/parse "2026-09-30T22:05:00Z"))
               :process-alive? true})]
  (assert= "summarise scenario 03: a request that finished 6 minutes ago does not itself imply stuck"
           1 (:requests report))
  (assert= "summarise scenario 03: a generating log line 30s old reports generating, not idle/stuck"
           :generating (:state report)))

;; ── default-ollama-log (BL-1851 bounce-lesson fix: shared by both CLIs) ──
;; Both logs present, operator log OLDER -> the seat's own serve.log wins.
(let [root (fs/create-temp-dir)
      swarm (fs/path root ".swarmforge" "ollama" "serve.log")
      operator (fs/path root ".swarmforge" "ollama-serve-operator.log")]
  (try
    (do (fs/create-dirs (fs/parent swarm))
        (spit (str swarm) "seat log\n")
        (spit (str operator) "operator log\n")
        (fs/set-last-modified-time swarm (java.time.Instant/ofEpochMilli 1700000000000))
        (fs/set-last-modified-time operator (java.time.Instant/ofEpochMilli 1699999000000))
        (assert= "default-ollama-log: both present, operator older -> seat's own serve.log"
                 (str swarm) (local-seat-report-lib/default-ollama-log (str root))))
    (finally (fs/delete-tree root))))
;; Both present, operator NEWER -> the operator log wins.
(let [root (fs/create-temp-dir)
      swarm (fs/path root ".swarmforge" "ollama" "serve.log")
      operator (fs/path root ".swarmforge" "ollama-serve-operator.log")]
  (try
    (do (fs/create-dirs (fs/parent swarm))
        (spit (str swarm) "seat log\n")
        (spit (str operator) "operator log\n")
        (fs/set-last-modified-time swarm (java.time.Instant/ofEpochMilli 1699999000000))
        (fs/set-last-modified-time operator (java.time.Instant/ofEpochMilli 1700000000000))
        (assert= "default-ollama-log: both present, operator newer -> operator log"
                 (str operator) (local-seat-report-lib/default-ollama-log (str root))))
    (finally (fs/delete-tree root))))
;; Only the swarm log present -> the seat's own serve.log.
(let [root (fs/create-temp-dir)
      swarm (fs/path root ".swarmforge" "ollama" "serve.log")]
  (try
    (do (fs/create-dirs (fs/parent swarm))
        (spit (str swarm) "seat log\n")
        (assert= "default-ollama-log: only swarm present -> seat's own serve.log"
                 (str swarm) (local-seat-report-lib/default-ollama-log (str root))))
    (finally (fs/delete-tree root))))
;; Both present, EXACTLY equal mtime -> the tie-break favors the swarm log.
(let [root (fs/create-temp-dir)
      swarm (fs/path root ".swarmforge" "ollama" "serve.log")
      operator (fs/path root ".swarmforge" "ollama-serve-operator.log")]
  (try
    (do (fs/create-dirs (fs/parent swarm))
        (spit (str swarm) "seat log\n")
        (spit (str operator) "operator log\n")
        (fs/set-last-modified-time swarm (java.time.Instant/ofEpochMilli 1700000000000))
        (fs/set-last-modified-time operator (java.time.Instant/ofEpochMilli 1700000000000))
        (assert= "default-ollama-log: both present, equal mtime -> seat's own serve.log wins the tie"
                 (str swarm) (local-seat-report-lib/default-ollama-log (str root))))
    (finally (fs/delete-tree root))))
;; Only the operator log present -> the operator log.
(let [root (fs/create-temp-dir)
      operator (fs/path root ".swarmforge" "ollama-serve-operator.log")]
  (try
    (do (fs/create-dirs (fs/parent operator))
        (spit (str operator) "operator log\n")
        (assert= "default-ollama-log: only operator present -> operator log"
                 (str operator) (local-seat-report-lib/default-ollama-log (str root))))
    (finally (fs/delete-tree root))))
;; Neither present -> nil.
(let [root (fs/create-temp-dir)]
  (try
    (assert= "default-ollama-log: neither present -> nil"
             nil (local-seat-report-lib/default-ollama-log (str root)))
    (finally (fs/delete-tree root))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
