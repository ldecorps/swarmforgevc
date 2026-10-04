#!/usr/bin/env bb
;; BL-1851: TDD runner for local_seat_tuning_report_lib.bb's pure grouping
;; and summarising. All five acceptance scenarios encoded directly as unit
;; cases, plus edge cases the acceptance feature does not reach (nil
;; settings/served, the FIRM "unknown, never 0" invariant on an absent
;; field).
(ns local-seat-tuning-report-lib-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "local_seat_tuning_report_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-nil [msg actual] (assert= msg nil actual))

(defn- ts [minute] (format "2026-09-30T20:%02d:00.000Z" minute))
(defn- req [minute & {:as overrides}]
  (merge {:timestamp (ts minute) :session-id "S1"} overrides))

;; ── settings-at-or-before / served-at-or-before ───────────────────────────

(def settings-before {:at "2026-09-30T19:00:00Z" :fingerprint "fp1" :gpu {:powerLimitW 180.0 :defaultPowerLimitW 180.0}})
(def settings-after {:at "2026-09-30T20:30:00Z" :fingerprint "fp2" :gpu {:powerLimitW 150.0 :defaultPowerLimitW 180.0}})

(assert= "settings-at-or-before: picks the latest row at or before the time"
         settings-before
         (local-seat-tuning-report-lib/settings-at-or-before [settings-before settings-after] (ts 10)))
(assert-nil "settings-at-or-before: nil when every row is later (request before the first row)"
            (local-seat-tuning-report-lib/settings-at-or-before [settings-before settings-after] "2026-09-30T18:00:00Z"))
(assert-nil "settings-at-or-before: nil on an empty rows list"
            (local-seat-tuning-report-lib/settings-at-or-before [] (ts 10)))
(assert= "settings-at-or-before: a request timestamped EXACTLY at a row's :at is AT, not before, that row"
         settings-after
         (local-seat-tuning-report-lib/settings-at-or-before [settings-before settings-after] (:at settings-after)))

;; ── served-label ───────────────────────────────────────────────────────────

(assert= "served-label: N/M layers, KV KV"
         "57/65 layers, f16 KV"
         (local-seat-tuning-report-lib/served-label {:layers-on-gpu 57 :layers-total 65 :kv-cache-type "f16"}))
(assert-nil "served-label: nil when served is nil" (local-seat-tuning-report-lib/served-label nil))
(assert-nil "served-label: nil when the layer facts are themselves absent"
            (local-seat-tuning-report-lib/served-label {:kv-cache-type "f16"}))
(assert= "served-label: layers with a nil :kv-cache-type print ', unknown KV'"
         "57/65 layers, unknown KV"
         (local-seat-tuning-report-lib/served-label {:layers-on-gpu 57 :layers-total 65}))

;; ── BL-1851 scenario 01: requests group by the settings in force, even
;;    within one session ───────────────────────────────────────────────────

(let [requests (concat (for [i (range 12)] (req i))
                        (for [i (range 8)] (req (+ 40 i))))
      groups (local-seat-tuning-report-lib/partition-into-groups
              {:requests requests :compressions [] :tool-calls []
               :settings-rows [settings-before settings-after] :ollama-loads []})]
  (assert= "scenario 01: two groups" 2 (count groups))
  (assert= "scenario 01: first group has 12 requests"
           12 (count (filter #(= :request (:kind %)) (:events (first groups)))))
  (assert= "scenario 01: second group has 8 requests"
           8 (count (filter #(= :request (:kind %)) (:events (second groups)))))
  (assert= "scenario 01: names the GPU power limit difference"
           ["GPU power limit 180 W -> 150 W"]
           (local-seat-tuning-report-lib/group-transition-diffs
            (first groups) (second groups) settings-before settings-after)))

;; ── BL-1851 scenario 02: a group's turn numbers ────────────────────────────

(let [requests [(req 0 :ttft-ms 10000 :duration-ms 30000 :input-tokens 12000 :output-tokens 480 :thinking-tokens 120)
                (req 1 :ttft-ms 20000 :duration-ms 60000 :input-tokens 16000 :output-tokens 960 :thinking-tokens 240)
                (req 2 :ttft-ms 40000 :duration-ms 100000 :input-tokens 24000 :output-tokens 1200 :thinking-tokens 600)]
      [group] (local-seat-tuning-report-lib/partition-into-groups
               {:requests requests :compressions [] :tool-calls [] :settings-rows [] :ollama-loads []})
      summary (local-seat-tuning-report-lib/summarise-group group)]
  (assert= "scenario 02: median ttft 20 s" 20.0 (:median-ttft-s summary))
  (assert= "scenario 02: prefill 800 tokens/s" 800.0 (:median-prefill-tps summary))
  (assert= "scenario 02: decode 24 tokens/s" 24.0 (:median-decode-tps summary))
  (assert= "scenario 02: median output 960 tokens" 960.0 (:median-output-tokens summary))
  (assert= "scenario 02: thinking at 25% of output" 0.25 (:median-thinking-share summary)))

;; ── median: an EVEN count of values averages the two middle ones ─────────
;;    (scenario 02's own fixture is odd-count, so this branch would
;;    otherwise never run at all)

(let [requests [(req 0 :output-tokens 100) (req 1 :output-tokens 200)
                (req 2 :output-tokens 300) (req 3 :output-tokens 400)]
      [group] (local-seat-tuning-report-lib/partition-into-groups
               {:requests requests :compressions [] :tool-calls [] :settings-rows [] :ollama-loads []})
      summary (local-seat-tuning-report-lib/summarise-group group)]
  (assert= "median: an even count averages its two middle values ((200+300)/2)"
           250.0 (:median-output-tokens summary)))

;; ── BL-1851 scenario 03: compressions and tool-call failures ──────────────

(let [requests (for [i (range 40)] (req i))
      compressions (for [i (range 4)] {:timestamp (ts i) :tokens-before 18000 :tokens-after 16000})
      tool-calls (concat (for [i (range 17)] {:timestamp (ts i) :function-name "run_shell_command" :success? true})
                          [{:timestamp (ts 1) :function-name "edit" :success? false}
                           {:timestamp (ts 2) :function-name "edit" :success? false}
                           {:timestamp (ts 3) :function-name "read_file" :success? false}])
      [group] (local-seat-tuning-report-lib/partition-into-groups
               {:requests requests :compressions compressions :tool-calls tool-calls
                :settings-rows [] :ollama-loads []})
      summary (local-seat-tuning-report-lib/summarise-group group)]
  (assert= "scenario 03: 1 compression per 10 requests" 1.0 (:compressions-per-10-requests summary))
  (assert= "scenario 03: saving 2000 tokens each" 2000.0 (:median-tokens-saved summary))
  (assert= "scenario 03: tool-call failure rate 15%" 15.0 (:tool-call-failure-rate summary))
  (assert= "scenario 03: edit failing most" "edit" (:most-failing-tool summary)))

;; ── BL-1851 scenario 04: same settings, split by how Ollama served ───────

(let [requests (concat (for [i (range 5)] (req i)) (for [i (range 5)] (req (+ 10 i))))
      loads [{:at-ms (.toEpochMilli (java.time.Instant/parse "2026-09-30T19:00:00Z"))
              :layers-on-gpu 57 :layers-total 65 :kv-cache-type "f16"}
             {:at-ms (.toEpochMilli (java.time.Instant/parse "2026-09-30T20:05:30Z"))
              :layers-on-gpu 65 :layers-total 65 :kv-cache-type "q8_0"}]
      groups (local-seat-tuning-report-lib/partition-into-groups
              {:requests requests :compressions [] :tool-calls [] :settings-rows [] :ollama-loads loads})]
  (assert= "scenario 04: two groups" 2 (count groups))
  (assert= "scenario 04: first served as 57/65 layers, f16 KV" "57/65 layers, f16 KV" (second (:key (first groups))))
  (assert= "scenario 04: second served as 65/65 layers, q8_0 KV" "65/65 layers, q8_0 KV" (second (:key (second groups))))
  (assert= "scenario 04: group-transition-diffs prints only the served line, same settings row both sides"
           ["served 57/65 layers, f16 KV -> 65/65 layers, q8_0 KV"]
           (local-seat-tuning-report-lib/group-transition-diffs
            (first groups) (second groups) settings-before settings-before)))

;; ── group-transition-diffs: a served change never reports when the
;;    fingerprint ALSO changed at the same boundary - the settings diff
;;    alone speaks for that boundary (lib's own documented independence) ──

(assert= "group-transition-diffs: a settings AND served change together prints only the settings diff"
         ["GPU power limit 180 W -> 150 W"]
         (local-seat-tuning-report-lib/group-transition-diffs
          {:key ["fp1" "57/65 layers, f16 KV"]} {:key ["fp2" "65/65 layers, q8_0 KV"]}
          settings-before settings-after))

;; ── BL-1851 scenario 05: a request before the first settings row is
;;    unrecorded ───────────────────────────────────────────────────────────

(let [[group] (local-seat-tuning-report-lib/partition-into-groups
               {:requests [(req 0)] :compressions [] :tool-calls []
                :settings-rows [settings-after] :ollama-loads []})]
  (assert= "scenario 05: grouped under unrecorded settings"
           local-seat-tuning-report-lib/unrecorded-settings
           (first (:key group))))

;; ── FIRM invariant 2: a field no record carries reads unknown, never 0 ───

(let [requests [(req 0)] ; no ttft/duration/tokens at all
      [group] (local-seat-tuning-report-lib/partition-into-groups
               {:requests requests :compressions [] :tool-calls [] :settings-rows [] :ollama-loads []})
      summary (local-seat-tuning-report-lib/summarise-group group)]
  (assert-nil "invariant 2: median ttft is nil (unknown), never 0, when no request carries ttft" (:median-ttft-s summary))
  (assert-nil "invariant 2: prefill is nil when there is no ttft/input to compute it from" (:median-prefill-tps summary))
  (assert-nil "invariant 2: median tokens saved is nil when there are no compressions" (:median-tokens-saved summary))
  (assert-nil "invariant 2: tool-call failure rate is nil when there are no tool calls" (:tool-call-failure-rate summary))
  (assert-nil "invariant 2: most-failing-tool is nil when there are no failures" (:most-failing-tool summary)))

;; ── most-failing-tool: a count TIE breaks alphabetically, deterministically
;;    (never left to group-by's own hash-map iteration order) ─────────────

(assert= "most-failing-tool: a tied failure count breaks alphabetically, not by map order"
         "alpha"
         (local-seat-tuning-report-lib/most-failing-tool
          [{:function-name "zeta"} {:function-name "alpha"}]))
(assert= "most-failing-tool: a tied failure count breaks alphabetically regardless of input order"
         "alpha"
         (local-seat-tuning-report-lib/most-failing-tool
          [{:function-name "alpha"} {:function-name "zeta"}]))

;; ── settings-diff: a path present on only one side also differs ──────────

(assert= "settings-diff: a path present only on the after side reads unknown -> value"
         ["model unknown -> m2"]
         (local-seat-tuning-report-lib/settings-diff {} {:model "m2"}))
(assert= "settings-diff: nil before/after produce no diff at all" [] (local-seat-tuning-report-lib/settings-diff nil nil))

;; ── group-key: a known settings+served pair never changes across a
;;    stretch of identical rows, so no spurious group boundary appears ────

(let [requests (for [i (range 6)] (req i))
      [groups] [(local-seat-tuning-report-lib/partition-into-groups
                 {:requests requests :compressions [] :tool-calls []
                  :settings-rows [settings-before] :ollama-loads []})]]
  (assert= "group-key: six requests under one unchanging settings row stay in ONE group" 1 (count groups)))

;; ── report ──────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS: local_seat_tuning_report_lib.bb")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
