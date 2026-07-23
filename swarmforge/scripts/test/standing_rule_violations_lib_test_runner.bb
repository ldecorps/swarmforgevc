#!/usr/bin/env bb
;; BL-337: TDD runner for standing_rule_violations_lib.bb's pure functions
;; - no filesystem I/O beyond reading the REAL constitution files (the
;; ticket's own "TRAP - zero violations" warning demands validating the
;; derivation against at least one KNOWN violation, not a synthetic
;; fixture standing in for it - this runner reads the real, live
;; engineering.prompt/local-engineering.prompt/architect.prompt exactly as
;; committed). Mirrors operator_lib_test_runner.bb.

(ns standing-rule-violations-lib-test-runner
  (:require [babashka.fs :as fs]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(def swarmforge-dir (str (fs/path script-dir "..")))
(load-file (str (fs/path script-dir "standing_rule_violations_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── parse-rule-blocks / citations-in-block (synthetic fixtures) ─────────

(def sample-content
  "# Article\n\n## Section\n- First rule, one line. (BL-001: the incident.)\n- Second rule\n  wraps onto\n  a continuation line. (BL-010: first hit. BL-011: recurred.)\n- Third rule with a provenance credit (source: `some/tool.ts`, BL-099) and no violations.\n")

(def blocks (standing-rule-violations-lib/parse-rule-blocks sample-content))

(assert= "parse-rule-blocks: finds exactly the 3 top-level bullets"
         3 (count blocks))

(assert= "citations-in-block: a single-citation rule"
         ["BL-001"] (standing-rule-violations-lib/citations-in-block (first blocks)))

(assert= "citations-in-block: a multi-citation rule, distinct + numerically ascending"
         ["BL-010" "BL-011"] (standing-rule-violations-lib/citations-in-block (second blocks)))

(assert= "citations-in-block: a provenance-only citation (source: ...) is never counted at all"
         [] (standing-rule-violations-lib/citations-in-block (nth blocks 2)))

(assert= "citations-in-block: a duplicate citation within one rule counts once"
         ["BL-005"]
         (standing-rule-violations-lib/citations-in-block
          "- A rule cited twice. (BL-005: first. Also BL-005 again in the same note.)"))

(assert= "citations-in-block: sorts NUMERICALLY, not lexically (BL-9 before BL-10)"
         ["BL-9" "BL-10"]
         (standing-rule-violations-lib/citations-in-block "- Out of order. (BL-10 and BL-9.)"))

;; ── violation-citations (standing-rule-violation-observable-02) ─────────

(assert= "violation-citations: the numerically-smallest (origin) citation is excluded"
         ["BL-252" "BL-253"]
         (standing-rule-violations-lib/violation-citations ["BL-250" "BL-252" "BL-253"]))

(assert= "violation-citations: a rule with only its own origin citation has zero violations"
         [] (standing-rule-violations-lib/violation-citations ["BL-001"]))

(assert= "violation-citations: a rule with no citations at all has zero violations"
         [] (standing-rule-violations-lib/violation-citations []))

(assert= "rule-summary: strips the bullet marker and bold markers, keeps the gist"
         "First rule, one line."
         (standing-rule-violations-lib/rule-summary "- **First rule, one line.**"))

(assert= "rule-summary: strips a numbered-list marker too"
         "Two phone-viewable surfaces."
         (standing-rule-violations-lib/rule-summary "5. Two phone-viewable surfaces."))

(assert-true "rule-summary: truncates an overlong first line"
             (<= (count (standing-rule-violations-lib/rule-summary
                         (str "- " (apply str (repeat 200 "x")))))
                 90))

;; ── scan-file-violations / scan-violations ───────────────────────────────
;; standing-rule-violation-observable-05: every rule is returned, even
;; with zero violations since landing.

(def scanned (standing-rule-violations-lib/scan-file-violations "fixture.prompt" sample-content))

(assert= "scan-file-violations: ALL 3 rules are returned, none omitted (observable-05)"
         3 (count scanned))
(assert= "scan-file-violations: rule 1 (origin-only citation) has zero violations since landing"
         0 (:count (first scanned)))
(assert= "scan-file-violations: rule 2's origin (BL-010) is excluded, BL-011 remains - one violation"
         1 (:count (second scanned)))
(assert= "scan-file-violations: rule 3 (provenance-only) has zero violations"
         0 (:count (nth scanned 2)))

(assert= "scan-violations: sorts most-violated first across files"
         [1 0 0]
         (mapv :count (standing-rule-violations-lib/scan-violations
                       [{:path "fixture.prompt" :content sample-content}])))

;; ── citing-rules-for-ticket / total-citation-count ───────────────────────

(def violations (standing-rule-violations-lib/scan-violations [{:path "fixture.prompt" :content sample-content}]))

(assert= "citing-rules-for-ticket: finds the rule where the ticket is a genuine violation (not the origin)"
         1 (count (standing-rule-violations-lib/citing-rules-for-ticket violations "BL-011")))
(assert= "citing-rules-for-ticket: the rule's OWN origin ticket is never counted as citing it"
         0 (count (standing-rule-violations-lib/citing-rules-for-ticket violations "BL-010")))
(assert= "citing-rules-for-ticket: a ticket never cited anywhere returns empty, not an error"
         [] (standing-rule-violations-lib/citing-rules-for-ticket violations "BL-999"))
(assert= "total-citation-count: sums every rule's own violation count"
         1 (standing-rule-violations-lib/total-citation-count violations))

;; ── KNOWN VIOLATION against the REAL, live constitution files ────────────
;; The ticket's own "TRAP - zero violations" warning: prove the mechanism
;; detects a violation it is SHOWN, against real committed text, not a
;; fixture. Verified by hand before this test was written:
;;   - engineering.prompt's Scenario-Outline KNOWN_VALUES rule cites
;;     BL-250/BL-252/BL-253 (landed together, 2026-07-10, commit
;;     40fdf6b3) - BL-250 is the numerically-smallest (origin); BL-252 and
;;     BL-253 are its real recorded violations since landing.
;;   - local-engineering.prompt's two-phone-surfaces rule cites
;;     BL-252/BL-257/BL-265 (landed together, 2026-07-10, commit
;;     74121ef5) - BL-252 is the numerically-smallest there, so in THIS
;;     rule BL-252 is the origin, not a violation.
;;   - architect.prompt's co-change-tool citation (BL-255) is a
;;     "(source: ..., BL-255)" provenance credit, not a violation record.

(def real-files
  [{:path "engineering.prompt"
    :content (slurp (str (fs/path swarmforge-dir "constitution" "articles" "engineering.prompt")))}
   {:path "local-engineering.prompt"
    :content (slurp (str (fs/path swarmforge-dir "constitution" "articles" "local-engineering.prompt")))}
   {:path "architect.prompt"
    :content (slurp (str (fs/path swarmforge-dir "roles" "architect.prompt")))}])

(def real-violations (standing-rule-violations-lib/scan-violations real-files))

(assert= "KNOWN VIOLATION: BL-252 is a recorded violation of the Scenario-Outline rule (BL-250 is that rule's origin)"
         1 (count (standing-rule-violations-lib/citing-rules-for-ticket real-violations "BL-252")))

(assert= "KNOWN ORIGIN, NOT A VIOLATION: BL-250 is the Scenario-Outline rule's OWN origin citation, never counted against it"
         0 (count (standing-rule-violations-lib/citing-rules-for-ticket real-violations "BL-250")))

(assert= "KNOWN NON-VIOLATION: BL-255's only real citation is a provenance credit (source: ...), correctly excluded"
         0 (count (standing-rule-violations-lib/citing-rules-for-ticket real-violations "BL-255")))

(assert-true "the real scan finds more than a trivial number of rules across the real files (the mechanism is not a no-op)"
             (> (count real-violations) 30))
(assert-true "at least a few real rules show a nonzero violation count (not every rule collapses to zero)"
             (> (count (filter #(pos? (:count %)) real-violations)) 5))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "standing_rule_violations_lib: ALL TESTS PASSED"))
