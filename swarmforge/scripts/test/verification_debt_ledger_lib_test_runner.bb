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

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
