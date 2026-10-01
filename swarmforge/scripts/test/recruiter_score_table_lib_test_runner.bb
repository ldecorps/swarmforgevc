#!/usr/bin/env bb
;; TDD runner for recruiter_score_table_lib.bb (BL-1822) - pure assertions
;; over injected table/filename data.
(ns recruiter-score-table-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "recruiter_score_table_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; A tiny stand-in for briefing-email-lib/briefing-date-label (the real fn
;; is injected by the CLI at the live call site - never re-implemented
;; here).
(defn- fake-date-label [filename]
  (second (re-matches #"(\d{4}-\d{2}-\d{2})\.md" filename)))

;; ── render-model-scout-section: no table ────────────────────────────────

(assert= "no table at all"
         "Model scout: no scout has run yet."
         (recruiter-score-table-lib/render-model-scout-section nil "2026-09-30"))

(assert= "no table, even with no previous briefing date either"
         "Model scout: no scout has run yet."
         (recruiter-score-table-lib/render-model-scout-section nil nil))

;; ── render-model-scout-section: stale ────────────────────────────────────

(assert= "a table updated ON the previous briefing's own date is stale (not strictly after)"
         "Model scout: no new scout since the previous briefing."
         (recruiter-score-table-lib/render-model-scout-section
          {"updated_at" "20260930T120000Z" "rows" [] "recommend" {}}
          "2026-09-30"))

(assert= "a table updated BEFORE the previous briefing is stale"
         "Model scout: no new scout since the previous briefing."
         (recruiter-score-table-lib/render-model-scout-section
          {"updated_at" "20260929T120000Z" "rows" [] "recommend" {}}
          "2026-09-30"))

(assert= "a table with no updated_at field at all is stale (fails closed), never a crash"
         "Model scout: no new scout since the previous briefing."
         (recruiter-score-table-lib/render-model-scout-section
          {"rows" [] "recommend" {}}
          "2026-09-30"))

;; ── render-model-scout-section: fresh ────────────────────────────────────

(assert= "a table updated after the previous briefing lists rows best-first and the recommend line"
         "Model scout:\n- **b** — 5/5 (incumbent)\n- **a** — 3/5\n- **c** — 1/5\nRecommend: keep the incumbent b (5/5)"
         (recruiter-score-table-lib/render-model-scout-section
          {"updated_at" "20261001T000000Z"
           "rows" [{"model" "a" "passed" 3 "total" 5 "incumbent" false}
                   {"model" "b" "passed" 5 "total" 5 "incumbent" true}
                   {"model" "c" "passed" 1 "total" 5 "incumbent" false}]
           "recommend" {"specifier" "keep the incumbent b (5/5)"}}
          "2026-09-30"))

(assert= "a table with no previous briefing at all (first-ever run) always renders fresh"
         "Model scout:\n- **a** — 2/4\nRecommend: no recommendation"
         (recruiter-score-table-lib/render-model-scout-section
          {"updated_at" "20261001T000000Z"
           "rows" [{"model" "a" "passed" 2 "total" 4 "incumbent" false}]
           "recommend" {}}
          nil))

;; ── previous-briefing-date ────────────────────────────────────────────────

(assert= "the latest date strictly before today, among mixed filenames"
         "2026-09-30"
         (recruiter-score-table-lib/previous-briefing-date
          ["2026-09-29.md" "2026-09-30.md" ".sent.json" "README.md"]
          "2026-10-01" fake-date-label))

(assert= "today's own briefing (already written) is excluded, never counted as the previous one"
         "2026-09-30"
         (recruiter-score-table-lib/previous-briefing-date
          ["2026-09-30.md" "2026-10-01.md"]
          "2026-10-01" fake-date-label))

(assert= "no qualifying file at all (first-ever run) is nil"
         nil
         (recruiter-score-table-lib/previous-briefing-date
          [] "2026-10-01" fake-date-label))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "recruiter_score_table_lib_test_runner: ok")
