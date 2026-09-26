#!/usr/bin/env bb
;; BL-1700 bounce (QA 20260926, D1/D2): model_steward_coder_probe_lib.bb had
;; no dedicated test file of its own - only the acceptance feature (which
;; always injects both cap flags) and selftest! (which never drives a
;; fixture) covered it, so an omitted cap flag NPE'd on every real
;; invocation without ever going red here. Real throwaway repo + tmux +
;; stand-in per case (seconds each, never a real model) - the SAME
;; run-fixture! a real probe invocation calls, never a re-statement of it.
(ns model-steward-coder-probe-lib-test-runner)

(def scripts-dir (str (babashka.fs/parent (babashka.fs/parent (babashka.fs/canonicalize *file*)))))
(load-file (str (babashka.fs/path scripts-dir "model_steward_coder_probe_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── D1: no cap flags at all must never NPE, and must still run to a real
;; outcome on the harness's own documented defaults. ──────────────────────
(let [result (model-steward-coder-probe-lib/run-fixture!
              {:fixture-id "01-one-line-fix" :stand-in-mode "solve"})]
  (assert-true "D1: no cap flags - run-fixture! returns a real outcome, never throws"
               (some? (:outcome result)))
  (assert= "D1: no cap flags - a solving stand-in still hands off" "handed off" (:outcome result))
  (assert-true "D1: no cap flags - handedOff is true" (:handedOff result)))

;; ── D1: only --wall-clock-seconds given (max-ticks omitted) must never
;; NPE either - the exact second repro QA's bounce named. ─────────────────
(let [result (model-steward-coder-probe-lib/run-fixture!
              {:fixture-id "01-one-line-fix" :stand-in-mode "hang" :wall-clock-seconds 3})]
  (assert= "D1: only wall-clock-seconds given - reports wall-clock cap, never an NPE"
           "wall-clock cap" (:outcome result))
  (assert-true "D1: only wall-clock-seconds given - takes roughly that long, not an instant tick exhaustion"
               (>= (:wallSeconds result) 2.5)))

;; ── D2: a hung seat is bound by wall-clock-seconds, never by a small
;; max-ticks converted to raw poll ticks (the ~20s-regardless-of-900s bug). ─
(let [result (model-steward-coder-probe-lib/run-fixture!
              {:fixture-id "01-one-line-fix" :stand-in-mode "hang"
               :wall-clock-seconds 3 :max-ticks 5})]
  (assert= "D2: a hung seat with a tiny max-ticks is still bound by wall-clock-seconds"
           "wall-clock cap" (:outcome result))
  (assert-true "D2: a hung seat with a tiny max-ticks runs the full wall-clock budget, not ~5 poll ticks"
               (>= (:wallSeconds result) 2.5))
  (assert= "D2: a hung seat never used a real turn" 0 (:turns result)))

;; ── D2: max-ticks now counts REAL model turns - a stand-in that never
;; commits takes one real turn per instruction, so max-ticks 1 stops after
;; exactly one, well inside a much larger wall-clock budget. ──────────────
(let [result (model-steward-coder-probe-lib/run-fixture!
              {:fixture-id "01-one-line-fix" :stand-in-mode "never"
               :wall-clock-seconds 30 :max-ticks 1})]
  (assert= "D2: a real turn cap fires on real turns taken" "turn cap" (:outcome result))
  (assert= "D2: the scorecard's own turns field matches the cap that fired" 1 (:turns result))
  (assert-true "D2: a real turn cap fires fast, nowhere near the 30s wall-clock budget"
               (< (:wallSeconds result) 15)))

;; ── D3: the scorecard always carries a :turns field and an
;; :llmHistoryPath field (nil for a stand-in run - no real transcript). ──
(let [result (model-steward-coder-probe-lib/run-fixture!
              {:fixture-id "01-one-line-fix" :stand-in-mode "solve"})]
  (assert-true "D3: scorecard carries a :turns field" (contains? result :turns))
  (assert-true "D3: scorecard carries an :llmHistoryPath field" (contains? result :llmHistoryPath))
  (assert= "D3: a stand-in run's llmHistoryPath is nil - no real aider, no real transcript"
           nil (:llmHistoryPath result)))

;; ── D3: resolve-model-id's own fallback - an unreachable/malformed
;; endpoint never blocks resolution, it just echoes the request back. ─────
(assert= "D3: resolve-model-id falls back to the raw model id when the endpoint cannot be read"
         "some-model" (model-steward-coder-probe-lib/resolve-model-id "http://127.0.0.1:1/v1" "some-model"))

;; ── D3: resolve-model-id has FOUR branches (nil ids / exact match / :latest
;; match / else fallback) - only the nil-ids fallback above was ever tested
;; by the bounce's own new cases. A real /models fixture server (the same
;; curl call the function makes, never a mock of it) exercises the two the
;; bounce's repro didn't reach: a byte-identical id, and a bare id needing
;; the ":latest" tag ollama's own /v1/models always answers with (BL-755:
;; a multi-branch parser needs one distinct test per branch). ─────────────
(let [port (+ 18700 (mod (.pid (java.lang.ProcessHandle/current)) 1000))
      body "{\"data\":[{\"id\":\"qwen3-14b:latest\"},{\"id\":\"exact-match-model\"}]}"
      py-code (str "import http.server,sys\n"
                    "BODY=" (pr-str body) ".encode()\n"
                    "class H(http.server.BaseHTTPRequestHandler):\n"
                    " def do_GET(self):\n"
                    "  self.send_response(200)\n"
                    "  self.send_header('Content-Type','application/json')\n"
                    "  self.send_header('Content-Length',str(len(BODY)))\n"
                    "  self.end_headers()\n"
                    "  self.wfile.write(BODY)\n"
                    " def log_message(self,*a): pass\n"
                    "http.server.HTTPServer(('127.0.0.1'," (str port) "),H).serve_forever()\n")
      srv (babashka.process/process ["python3" "-c" py-code] {:out :inherit :err :inherit})
      endpoint (str "http://127.0.0.1:" port "/v1")]
  (try
    (loop [waited-ms 0]
      (when (and (< waited-ms 5000)
                 (not (model-steward-coder-probe-lib/endpoint-answers? endpoint)))
        (Thread/sleep 100)
        (recur (+ waited-ms 100))))
    (assert= "D3: resolve-model-id returns a byte-identical match unchanged"
             "exact-match-model"
             (model-steward-coder-probe-lib/resolve-model-id endpoint "exact-match-model"))
    (assert= "D3: resolve-model-id appends ':latest' when only the tagged id is listed"
             "qwen3-14b:latest"
             (model-steward-coder-probe-lib/resolve-model-id endpoint "qwen3-14b"))
    (assert= "D3: resolve-model-id falls back to the raw id when neither form is listed"
             "no-such-model"
             (model-steward-coder-probe-lib/resolve-model-id endpoint "no-such-model"))
    (finally
      (babashka.process/destroy-tree srv))))

;; ── BL-1700 QA D1 (2026-09-26, 2nd pass): probe! with no --evidence-dir
;; at all still writes the summary under backlog/evidence (the default) -
;; the exact gap the bounce named (the how-to's own invocation omits the
;; flag, so the JSON on stdout was the only trace). A real write, cleaned
;; up in a finally - never mocked, since the defect was the write not
;; happening at all. A one-off, timestamped marker model name so this can
;; never collide with a real probe's own evidence file in the same,
;; shared, live directory. ─────────────────────────────────────────────────
(let [marker (str "bl1700-d1-default-evidence-dir-check-" (System/currentTimeMillis))
      evidence-dir (str (babashka.fs/path (babashka.fs/parent (babashka.fs/parent scripts-dir)) "backlog" "evidence"))
      glob-pattern (str "local-coder-probe-" marker "-*.md")]
  (try
    (model-steward-coder-probe-lib/probe!
     {:model marker :stand-in-mode "solve" :fixture-ids-to-run ["01-one-line-fix"]})
    (let [written (vec (babashka.fs/glob evidence-dir glob-pattern))]
      (assert-true "D1: probe! with no --evidence-dir still writes exactly one summary under backlog/evidence"
                   (= 1 (count written)))
      (when (seq written)
        (assert-true "D1: the written summary names a verdict"
                     (clojure.string/includes? (slurp (str (first written))) "verdict"))))
    (finally
      (doseq [f (babashka.fs/glob evidence-dir glob-pattern)]
        (babashka.fs/delete f)))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
