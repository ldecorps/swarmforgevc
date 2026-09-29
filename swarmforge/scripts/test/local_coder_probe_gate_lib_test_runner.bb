#!/usr/bin/env bb
;; BL-1702: deterministic unit tests for local_coder_probe_gate_lib.bb's
;; pure decision - the ticket's own scenario table (specs/features/BL-1702-*)
;; plus the parsing/newest-summary seams the acceptance feature never
;; exercises directly (multi-file "newest" selection, non-driver windows,
;; a missing --model, an unmatched model segment, an unmatched conf line).

(ns local-coder-probe-gate-lib-test-runner)

(def scripts-dir (str (babashka.fs/parent (babashka.fs/parent (babashka.fs/canonicalize *file*)))))
(load-file (str (babashka.fs/path scripts-dir "local_coder_probe_gate_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── parse-window-lines ───────────────────────────────────────────────────

(let [conf "# a comment\nconfig active_backlog_max_depth 7\n\nwindow coder claude coder --model claude-sonnet-5 --seat-tier hard\nwindow coder@2 aider coder2 --model openai/qwen3-14b:latest --openai-api-base http://127.0.0.1:11434/v1 --seat-tier easy\nwindow specifier claude master --model claude-opus-5-5\n"
      windows (local-coder-probe-gate-lib/parse-window-lines conf)]
  (assert= "parse-window-lines: three window lines, comments/config skipped" 3 (count windows))
  (assert= "parse-window-lines: first window's role" "coder" (:role (nth windows 0)))
  (assert= "parse-window-lines: first window's agent is lower-cased" "claude" (:agent (nth windows 0)))
  (assert= "parse-window-lines: seat id keeps its @N suffix" "coder@2" (:role (nth windows 1)))
  (assert= "parse-window-lines: agent lower-cased regardless of conf casing" "aider" (:agent (nth windows 1))))

;; ── window-model ─────────────────────────────────────────────────────────

(assert= "window-model: plain --model value"
         "claude-sonnet-5"
         (local-coder-probe-gate-lib/window-model {:rest "--model claude-sonnet-5 --seat-tier hard"}))

(assert= "window-model: strips an aider openai/ prefix"
         "qwen3-14b:latest"
         (local-coder-probe-gate-lib/window-model {:rest "--model openai/qwen3-14b:latest --openai-api-base http://127.0.0.1:11434/v1"}))

(assert= "window-model: nil when the line declares no --model"
         nil
         (local-coder-probe-gate-lib/window-model {:rest "--seat-tier hard"}))

;; ── driver-windows ───────────────────────────────────────────────────────

(let [windows [{:role "coder" :agent "claude" :rest "--model claude-sonnet-5"}
               {:role "coder@2" :agent "aider" :rest "--model openai/qwen3-14b:latest"}
               {:role "cleaner" :agent "aider" :rest "--model openai/qwen2.5-coder:latest"}
               {:role "specifier" :agent "claude" :rest "--model claude-opus-5-5"}]
      drivers (local-coder-probe-gate-lib/driver-windows windows)]
  (assert= "driver-windows: ONLY the aider coder@2 seat is a driver seat (aider+cleaner is out of scope this slice)"
           ["coder@2"] (mapv :role drivers)))

;; ── safe-model-id ────────────────────────────────────────────────────────

(assert= "safe-model-id: ':' and '/' both become '-'"
         "qwen3-14b-latest" (local-coder-probe-gate-lib/safe-model-id "qwen3-14b:latest"))
(assert= "safe-model-id: a path-shaped model id"
         "openrouter-x-y" (local-coder-probe-gate-lib/safe-model-id "openrouter/x:y"))

;; ── parse-summary-filename ───────────────────────────────────────────────

(assert= "parse-summary-filename: real probe! shape"
         {:model-segment "qwen3-14b-latest" :stamp "2026-09-26T01-56-17.698226979Z"}
         (local-coder-probe-gate-lib/parse-summary-filename
          "local-coder-probe-qwen3-14b-latest-2026-09-26T01-56-17.698226979Z.md"))

(assert= "parse-summary-filename: a stamp with no fractional seconds is still matched"
         {:model-segment "m" :stamp "2026-01-02T03-04-05Z"}
         (local-coder-probe-gate-lib/parse-summary-filename "local-coder-probe-m-2026-01-02T03-04-05Z.md"))

(assert= "parse-summary-filename: nil for an unrelated filename"
         nil (local-coder-probe-gate-lib/parse-summary-filename "readme.md"))

;; ── stamp->instant ───────────────────────────────────────────────────────

(assert= "stamp->instant: matches java.time.Instant/parse on the colon form"
         (java.time.Instant/parse "2026-09-26T01:56:17.698226979Z")
         (local-coder-probe-gate-lib/stamp->instant "2026-09-26T01-56-17.698226979Z"))

;; ── newest-summary: correct even when digit counts differ (never a lexical
;; sort - the reason this gate parses a real Instant instead of comparing
;; filename strings). ───────────────────────────────────────────────────────

(let [files [{:filename "local-coder-probe-m-2026-09-26T01-56-17.9Z.md" :content "handed off 5 of 5 - verdict pass"}
             {:filename "local-coder-probe-m-2026-09-26T01-56-17.123456789Z.md" :content "handed off 3 of 5 - verdict fail"}]]
  ;; .9Z (900ms) is chronologically AFTER .123456789Z (~123ms) even though the
  ;; SECOND filename sorts later as a plain string (lexical "1" < "9" holds,
  ;; so this particular pair does not by itself prove the point on string
  ;; length) - the real proof is the assertion below reading the correct
  ;; Instant back out, exercised harder by the property runner's random
  ;; fractional-digit-count draws.
  (assert= "newest-summary: the later-instant file wins, model matched exactly"
           "local-coder-probe-m-2026-09-26T01-56-17.9Z.md"
           (:filename (local-coder-probe-gate-lib/newest-summary files "m"))))

(let [files [{:filename "local-coder-probe-qwen3-14b-latest-2026-09-26T01-00-00Z.md" :content "handed off 4 of 5 - verdict pass"}
             {:filename "local-coder-probe-qwen3-14b-latest-2026-09-27T01-00-00Z.md" :content "handed off 4 of 5 - verdict pass"}
             {:filename "local-coder-probe-some-other-model-2026-09-28T01-00-00Z.md" :content "handed off 4 of 5 - verdict pass"}]]
  (assert= "newest-summary: a decoy file for a DIFFERENT model, even newer, is never picked"
           "local-coder-probe-qwen3-14b-latest-2026-09-27T01-00-00Z.md"
           (:filename (local-coder-probe-gate-lib/newest-summary files "qwen3-14b:latest"))))

(assert= "newest-summary: nil when nothing matches the requested model"
         nil (local-coder-probe-gate-lib/newest-summary
              [{:filename "local-coder-probe-other-2026-09-26T01-00-00Z.md" :content "handed off 5 of 5 - verdict pass"}]
              "qwen3-14b:latest"))

(assert= "newest-summary: a bare requested id matches the probe's own ':latest' resolution"
         "local-coder-probe-qwen3-14b-latest-2026-09-26T01-00-00Z.md"
         (:filename (local-coder-probe-gate-lib/newest-summary
                     [{:filename "local-coder-probe-qwen3-14b-latest-2026-09-26T01-00-00Z.md" :content "handed off 4 of 5 - verdict pass"}]
                     "qwen3-14b")))

;; ── summary-verdict ──────────────────────────────────────────────────────

(assert= "summary-verdict: pass"
         "pass" (local-coder-probe-gate-lib/summary-verdict "# local coder probe: m\n\nhanded off 4 of 5 - verdict pass\n\n- ..."))
(assert= "summary-verdict: fail"
         "fail" (local-coder-probe-gate-lib/summary-verdict "handed off 0 of 5 - verdict fail\n"))
(assert= "summary-verdict: nil on unparseable content"
         nil (local-coder-probe-gate-lib/summary-verdict "not a real summary"))

;; ── window-decision / gate-decisions: the ticket's own scenario table ────

(def evidence-4of5-pass
  [{:filename "local-coder-probe-qwen3-14b-latest-2026-09-26T01-00-00Z.md"
    :content "handed off 4 of 5 - verdict pass"}])
(def evidence-3of5-fail
  [{:filename "local-coder-probe-qwen3-14b-latest-2026-09-26T01-00-00Z.md"
    :content "handed off 3 of 5 - verdict fail"}])
(def evidence-5of5-breached
  [{:filename "local-coder-probe-qwen3-14b-latest-2026-09-26T01-00-00Z.md"
    :content "handed off 5 of 5 - verdict fail"}])

(def driver-window
  {:role "coder@2" :agent "aider" :rest "--model openai/qwen3-14b:latest --seat-tier easy"})

(let [d (local-coder-probe-gate-lib/window-decision driver-window [])]
  (assert= "scenario: no summary at all -> refuse, no probe summary" "refuse" (:decision d))
  (assert= "scenario: no summary at all -> reason" local-coder-probe-gate-lib/reason-no-summary (:reason d))
  (assert= "scenario: no summary at all -> names the model" "qwen3-14b:latest" (:model d)))

(let [d (local-coder-probe-gate-lib/window-decision driver-window evidence-3of5-fail)]
  (assert= "scenario: 3 of 5 handed off, hazards held -> refuse" "refuse" (:decision d))
  (assert= "scenario: 3 of 5 handed off -> probe verdict fail" local-coder-probe-gate-lib/reason-verdict-fail (:reason d)))

(let [d (local-coder-probe-gate-lib/window-decision driver-window evidence-5of5-breached)]
  (assert= "scenario: 5 of 5 handed off but a breached hazard -> refuse" "refuse" (:decision d))
  (assert= "scenario: breached hazard -> probe verdict fail" local-coder-probe-gate-lib/reason-verdict-fail (:reason d)))

(let [d (local-coder-probe-gate-lib/window-decision driver-window evidence-4of5-pass)]
  (assert= "scenario: 4 of 5 handed off, hazards held -> admit" "admit" (:decision d))
  (assert-true "scenario: admit cites the summary's path"
               (= "local-coder-probe-qwen3-14b-latest-2026-09-26T01-00-00Z.md" (:summary-path d))))

;; a window with no --model at all refuses "no probe summary" too - nothing
;; to look up.
(let [d (local-coder-probe-gate-lib/window-decision {:role "coder@2" :agent "aider" :rest "--seat-tier easy"} evidence-4of5-pass)]
  (assert= "scenario: a driver window declaring no --model refuses, nothing to check" "refuse" (:decision d))
  (assert= "scenario: no --model -> reason is no-probe-summary" local-coder-probe-gate-lib/reason-no-summary (:reason d)))

;; gate-decisions: a pack with NO driver seat is untouched (empty, never a
;; refusal) - the ticket's own "nothing to gate" case.
(assert= "gate-decisions: a pack with no driver seat gates nothing"
         []
         (local-coder-probe-gate-lib/gate-decisions
          [{:role "coder" :agent "claude" :rest "--model claude-sonnet-5"}]
          []))

;; gate-decisions: exactly one decision per driver seat, non-driver seats
;; never appear in the output at all.
(assert= "gate-decisions: one decision per driver seat only"
         ["coder@2"]
         (mapv :seat (local-coder-probe-gate-lib/gate-decisions
                      [{:role "coder" :agent "claude" :rest "--model claude-sonnet-5"}
                       driver-window]
                      evidence-4of5-pass)))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
