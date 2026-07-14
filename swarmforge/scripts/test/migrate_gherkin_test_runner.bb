#!/usr/bin/env bb
;; TDD runner for migrate_gherkin_to_features_lib.bb's pure functions (BL-111) -
;; no filesystem, no real backlog files.
(ns migrate-gherkin-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "migrate_gherkin_to_features_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── indent-of ────────────────────────────────────────────────────────────
(assert= "indent-of counts leading spaces" 2 (migrate-gherkin-to-features-lib/indent-of "  Scenario: x"))
(assert= "indent-of is 0 for a top-level line" 0 (migrate-gherkin-to-features-lib/indent-of "acceptance: |"))
(assert= "indent-of is 0 for an empty line" 0 (migrate-gherkin-to-features-lib/indent-of ""))
(assert= "indent-of does not count a leading tab as a space" 0 (migrate-gherkin-to-features-lib/indent-of "\tScenario: x"))

;; ── acceptance-block-line-index ─────────────────────────────────────────
(assert= "finds the acceptance: | key line"
         2
         (migrate-gherkin-to-features-lib/acceptance-block-line-index ["id: BL-1" "title: x" "acceptance: |" "  Feature: y"]))

(assert= "finds acceptance: |- too (block chomping indicator)"
         1
         (migrate-gherkin-to-features-lib/acceptance-block-line-index ["id: BL-1" "acceptance: |-" "  Feature: y"]))

(assert= "returns nil when there is no acceptance: field at all"
         nil
         (migrate-gherkin-to-features-lib/acceptance-block-line-index ["id: BL-1" "title: x" "mutation_cost: low"]))

;; Idempotency (BL-111 feature-migration-01): an ALREADY-migrated ticket's
;; acceptance: field is a plain string reference, not a `|` block scalar -
;; re-running the migration must treat it as "nothing to migrate", never
;; re-migrate an already-migrated file or clobber the reference line.
(assert= "an already-migrated single-line acceptance: reference is not treated as a block to re-migrate"
         nil
         (migrate-gherkin-to-features-lib/acceptance-block-line-index ["id: BL-1" "acceptance: specs/features/BL-1.feature" "mutation_cost: low"]))

;; ── block-end-index ──────────────────────────────────────────────────────
(assert= "ends at the next top-level (column 0) non-blank line"
         3
         (migrate-gherkin-to-features-lib/block-end-index ["acceptance: |" "  Feature: x" "" "mutation_cost: low"] 0))

(assert= "runs to the end of the file when acceptance: is the last field"
         3
         (migrate-gherkin-to-features-lib/block-end-index ["acceptance: |" "  Feature: x" "  Scenario: y"] 0))

(assert= "a blank line inside the block does not end it"
         4
         (migrate-gherkin-to-features-lib/block-end-index ["acceptance: |" "  Feature: x" "" "  Scenario: y" "mutation_cost: low"] 0))

;; ── strip-common-indent ──────────────────────────────────────────────────
(assert= "removes the block scalar's 2-space indent"
         ["Feature: x" "Scenario: y"]
         (migrate-gherkin-to-features-lib/strip-common-indent ["  Feature: x" "  Scenario: y"]))

(assert= "leaves blank lines blank rather than erroring on a short substring"
         ["Feature: x" ""]
         (migrate-gherkin-to-features-lib/strip-common-indent ["  Feature: x" ""]))

;; A line with FEWER than 2 leading spaces cannot legitimately occur here:
;; every line inside a real `acceptance: |` YAML block scalar is indented
;; at least as much as the block's own first line (a YAML syntax rule), and
;; every observed ticket uses 2-space indent under that key - so this input
;; shape is out of the function's real calling contract. Pinning the actual
;; (over-truncating) behavior anyway: `(min 2 (count l))` clamps against the
;; LINE's own length, not its indent, so a too-short line loses content, not
;; just its indent. Documented here so a future change can't silently make
;; this worse without a test noticing, even though real input never hits it.
(assert= "a line shorter than the 2-space indent is over-truncated, not just de-indented (documented narrow contract)"
         [""]
         (migrate-gherkin-to-features-lib/strip-common-indent [" x"]))

;; ── feature-name-from-block ──────────────────────────────────────────────
(assert= "extracts the name after Feature:"
         "backlog Gherkin becomes durable feature files"
         (migrate-gherkin-to-features-lib/feature-name-from-block "Feature: backlog Gherkin becomes durable feature files\n\nScenario: x\n"))

(assert= "returns nil when there is no Feature: line"
         nil
         (migrate-gherkin-to-features-lib/feature-name-from-block "Scenario: x\n  Given y\n"))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: migrate_gherkin_to_features_lib.bb"))
