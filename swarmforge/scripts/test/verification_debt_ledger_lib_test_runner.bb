#!/usr/bin/env bb
;; BL-1782: TDD runner for verification_debt_ledger_lib.bb's pure core -
;; validation, idempotent recording, parse/render round-trip, the
;; threshold reader, and category ownership from ticket text.
(ns verification-debt-ledger-lib-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "verification_debt_ledger_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; ── validation ────────────────────────────────────────────────────────────
(assert-true "kebab-case category is valid" (verification-debt-ledger-lib/valid-category? "land-path-ownership"))
(assert-true "a single-word category is valid" (verification-debt-ledger-lib/valid-category? "landpathownership"))
(assert-true "a title-cased category is invalid" (not (verification-debt-ledger-lib/valid-category? "Land Path Ownership")))
(assert-true "BL-<n> ticket is valid" (verification-debt-ledger-lib/valid-ticket? "BL-9001"))
(assert-true "GH-<n> ticket is valid" (verification-debt-ledger-lib/valid-ticket? "GH-42"))
(assert-true "a bare number is not a valid ticket" (not (verification-debt-ledger-lib/valid-ticket? "9001")))
(assert-true "a blank description is invalid" (not (verification-debt-ledger-lib/valid-description? "")))
(assert-true "a blank (whitespace) description is invalid" (not (verification-debt-ledger-lib/valid-description? "   ")))
(assert-true "a real description is valid" (verification-debt-ledger-lib/valid-description? "grepped the branch"))

;; ── record-verification: idempotent under redelivery ─────────────────────
(let [req1 {:category "land-path-ownership" :ticket "BL-9001" :role "QA"
            :description "grepped the paths" :detected-at "2026-09-26"}
      {:keys [rows recorded?]} (verification-debt-ledger-lib/record-verification [] req1)]
  (assert-true "first record for a (category, ticket) is recorded" recorded?)
  (assert= "one row after the first record" 1 (count rows))
  (let [req2 (assoc req1 :role "architect" :description "checked again")
        {:keys [rows recorded?]} (verification-debt-ledger-lib/record-verification rows req2)]
    (assert-true "a second record for the SAME (category, ticket) is a no-op" (not recorded?))
    (assert= "still exactly one row" 1 (count rows))))

;; ── parse/render round-trip ───────────────────────────────────────────────
(let [rows [{:category "land-path-ownership" :ticket "BL-1711" :role "QA"
             :description "grepped the branch for the ticket's own paths"
             :detected-at "2026-09-26"}
            {:category "land-path-ownership" :ticket "BL-1768" :role "QA"
             :description "built by hand" :detected-at "2026-09-26" :evidence "backlog/evidence/BL-1768-QA-20260926.md"}]
      text (verification-debt-ledger-lib/render-ledger rows)
      parsed (verification-debt-ledger-lib/parse-ledger text)]
  (assert= "round-trip preserves every row" rows parsed))

;; ── outstanding-count / all-categories ────────────────────────────────────
(let [rows [{:category "a" :ticket "BL-1" :role "QA" :description "x" :detected-at "2026-09-26"}
            {:category "a" :ticket "BL-2" :role "QA" :description "x" :detected-at "2026-09-26"}
            {:category "b" :ticket "BL-3" :role "QA" :description "x" :detected-at "2026-09-26"}]]
  (assert= "outstanding-count counts rows for one category" 2 (verification-debt-ledger-lib/outstanding-count rows "a"))
  (assert= "outstanding-count for an absent category is zero" 0 (verification-debt-ledger-lib/outstanding-count rows "z"))
  (assert= "all-categories names every distinct category" ["a" "b"] (verification-debt-ledger-lib/all-categories rows)))

;; ── conf threshold ─────────────────────────────────────────────────────────
(assert= "default threshold with no conf line" 3 (verification-debt-ledger-lib/threshold (verification-debt-ledger-lib/parse-conf "")))
(assert= "an explicit threshold overrides the default" 2
         (verification-debt-ledger-lib/threshold (verification-debt-ledger-lib/parse-conf "config verification_debt_threshold 2\n")))
;; BL-1782 QA bounce D2: zero, a negative value, and a non-number all fall
;; back to the default - `parse-long` returning a non-positive long, or
;; nil for a non-number, must never pass through `or`'s own truthiness on
;; zero.
(assert= "a zero threshold falls back to the default" 3
         (verification-debt-ledger-lib/threshold (verification-debt-ledger-lib/parse-conf "config verification_debt_threshold 0\n")))
(assert= "a negative threshold falls back to the default" 3
         (verification-debt-ledger-lib/threshold (verification-debt-ledger-lib/parse-conf "config verification_debt_threshold -2\n")))
(assert= "a non-number threshold falls back to the default" 3
         (verification-debt-ledger-lib/threshold (verification-debt-ledger-lib/parse-conf "config verification_debt_threshold banana\n")))

;; ── default-conf-path (BL-1782 QA bounce D1) ──────────────────────────────
(assert= "default-conf-path names swarmforge/swarmforge.conf under the project root, never a root-level file"
         "/repo/swarmforge/swarmforge.conf"
         (verification-debt-ledger-lib/default-conf-path "/repo"))

;; ── declared-categories: top-level field only, never prose ────────────────
(assert= "a bare scalar declaration" #{"land-path-ownership"}
         (verification-debt-ledger-lib/declared-categories "verification_category: land-path-ownership\n"))
(assert= "a flow-list declaration" #{"other-check" "land-path-ownership"}
         (verification-debt-ledger-lib/declared-categories "verification_category: [other-check, land-path-ownership]\n"))
(assert= "an indented field declares nothing (never top-level)" #{}
         (verification-debt-ledger-lib/declared-categories "  verification_category: land-path-ownership\n"))
(assert= "a notes: mention never counts as a declaration" #{}
         (verification-debt-ledger-lib/declared-categories "notes: land-path-ownership needs a tool\n"))

;; ── BL-1783: settle (discharge / waive) ───────────────────────────────────
(let [rows [{:category "a" :ticket "BL-1" :role "QA" :description "x" :detected-at "2026-09-26"}
            {:category "a" :ticket "BL-2" :role "QA" :description "y" :detected-at "2026-09-26"}
            {:category "b" :ticket "BL-3" :role "QA" :description "z" :detected-at "2026-09-26"}]]
  ;; discharge: adds settle fields to every outstanding row of the category
  (let [{:keys [rows settled?]} (verification-debt-ledger-lib/discharge-category
                                  rows {:category "a" :by "coder" :evidence "backlog/evidence/BL-9200-tool.md" :on "2026-09-26"})]
    (assert-true "discharge settles the category" settled?)
    (assert= "discharge keeps all rows (never removes)" 3 (count rows))
    (let [a-rows (verification-debt-ledger-lib/rows-for-category rows "a")]
      (assert= "both a-rows gained discharged_at" 2 (count (filter :discharged-at a-rows)))
      (assert= "both a-rows gained discharged_by" 2 (count (filter #(= "coder" (:discharged-by %)) a-rows)))
      (assert= "both a-rows gained discharged_evidence" 2 (count (filter #(= "backlog/evidence/BL-9200-tool.md" (:discharged-evidence %)) a-rows)))
      ;; invariant 1: recorded fields unchanged
      (let [r1 (first a-rows)]
        (assert= "recorded fields survive discharge" "x" (:description r1))
        (assert= "detected_at survives discharge" "2026-09-26" (:detected-at r1))))
    (let [b-rows (verification-debt-ledger-lib/rows-for-category rows "b")]
      (assert= "b-rows untouched by a's discharge" 0 (count (filter :discharged-at b-rows)))))
  ;; discharge refuses: no evidence
  (let [{:keys [rows settled?]} (verification-debt-ledger-lib/discharge-category
                                  rows {:category "b" :by "coder" :evidence nil :on "2026-09-26"})]
    (assert-true "discharge with no evidence is refused" (not settled?))
    (assert= "refused discharge changes nothing" 3 (count rows)))
  ;; discharge refuses: no outstanding row in the category
  (let [{:keys [rows settled?]} (verification-debt-ledger-lib/discharge-category
                                  rows {:category "zzz" :by "coder" :evidence "backlog/evidence/BL-9200-tool.md" :on "2026-09-26"})]
    (assert-true "discharge with no outstanding row is refused" (not settled?)))
  ;; waive: adds waive fields to every outstanding row of the category
  (let [{:keys [rows settled?]} (verification-debt-ledger-lib/waive-category
                                  rows {:category "b" :by "human" :reason "novel shapes" :on "2026-09-26"})]
    (assert-true "waive settles the category" settled?)
    (let [b-rows (verification-debt-ledger-lib/rows-for-category rows "b")]
      (assert= "b-row gained waived_at" 1 (count (filter :waived-at b-rows)))
      (assert= "b-row gained waived_by" 1 (count (filter #(= "human" (:waived-by %)) b-rows)))
      (assert= "b-row gained waive_reason" 1 (count (filter #(= "novel shapes" (:waive-reason %)) b-rows)))))
  ;; waive refuses: blank reason
  (let [{:keys [rows settled?]} (verification-debt-ledger-lib/waive-category
                                  rows {:category "b" :by "human" :reason "" :on "2026-09-26"})]
    (assert-true "waive with a blank reason is refused" (not settled?)))
  ;; waive refuses: no --by
  (let [{:keys [rows settled?]} (verification-debt-ledger-lib/waive-category
                                  rows {:category "b" :by nil :reason "novel shapes" :on "2026-09-26"})]
    (assert-true "waive with no by is refused" (not settled?)))
  ;; outstanding-count excludes settled rows
  (let [{:keys [rows]} (verification-debt-ledger-lib/discharge-category
                         rows {:category "a" :by "coder" :evidence "backlog/evidence/BL-9200-tool.md" :on "2026-09-26"})]
    (assert= "discharged rows no longer count as outstanding" 0 (verification-debt-ledger-lib/outstanding-count rows "a"))
    (assert= "unsettled category still counts" 1 (verification-debt-ledger-lib/outstanding-count rows "b")))
  ;; a row recorded after a settle is outstanding and counts from one
  (let [{:keys [rows]} (verification-debt-ledger-lib/discharge-category
                         rows {:category "a" :by "coder" :evidence "backlog/evidence/BL-9200-tool.md" :on "2026-09-26"})]
    (let [{:keys [rows]} (verification-debt-ledger-lib/record-verification
                           rows {:category "a" :ticket "BL-4" :role "QA" :description "new check" :detected-at "2026-09-27"})]
      (assert= "a row recorded after a settle counts from one" 1 (verification-debt-ledger-lib/outstanding-count rows "a"))
      (assert= "the new row is outstanding (no settle fields)" nil (:discharged-at (last rows))))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
