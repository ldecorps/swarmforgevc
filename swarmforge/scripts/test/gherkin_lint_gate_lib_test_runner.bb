#!/usr/bin/env bb
;; TDD runner for gherkin_lint_gate_lib.bb (BL-515) - pure assertions over
;; hand-crafted feature text and hand-crafted parsed-IR maps. No live
;; vendored-parser invocation here (that end-to-end wiring is covered by
;; test_gherkin_lint_gate.sh); this runner proves the detection logic
;; itself.
(ns gherkin-lint-gate-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "gherkin_lint_gate_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── find-continuation-line-findings ────────────────────────────────────────

(def param-wrapped-step-feature
  "Feature: sample

  Scenario Outline: wraps
    Given a record with <telegram> Telegram
      events out of <total> total events
    When something happens
    Then it works

    Examples:
      | telegram | total |
      | 5        | 10    |
")

(assert= "515-01: a step wrapped with a <param> on the 2nd line is flagged at that line"
         [{:line 5 :text "events out of <total> total events"}]
         (gherkin-lint-gate-lib/find-continuation-line-findings param-wrapped-step-feature))

(def param-less-wrapped-step-feature
  "Feature: sample

  Scenario: wraps without a param
    Given a user logs in
      successfully
    Then the session starts
")

(assert= "515-02: a step wrapped with no <param> on the 2nd line is still flagged"
         [{:line 5 :text "successfully"}]
         (gherkin-lint-gate-lib/find-continuation-line-findings param-less-wrapped-step-feature))

(def clean-single-line-feature
  "@tag1
Feature: sample

  # a leading comment
  Background:
    Given a setup precondition

  # BL-515 clean-scenario-01
  Scenario Outline: fully referenced
    Given a value of <a>
    When it is combined with <b>
    Then the result is <c>

    Examples:
      | a | b | c |
      | 1 | 2 | 3 |
")

(assert= "515-03: a well-formed single-line-step feature with tags/comments has no findings"
         []
         (gherkin-lint-gate-lib/find-continuation-line-findings clean-single-line-feature))

(def data-table-feature
  "Feature: sample

  Scenario: uses a data table, not Examples
    Given the following items:
      | name | qty |
      | foo  | 1   |
    When something happens
    Then it works
")

(assert= "515-04: a step's own data table rows are not flagged as continuation lines"
         []
         (gherkin-lint-gate-lib/find-continuation-line-findings data-table-feature))

(def docstring-feature
  "Feature: sample

  Scenario: uses a docstring
    Given the following text:
      \"\"\"
      this is prose that spans
      multiple lines inside a docstring
      \"\"\"
    Then it works
")

(assert= "515-05: docstring content is not flagged as a continuation line"
         []
         (gherkin-lint-gate-lib/find-continuation-line-findings docstring-feature))

(assert= "515-06: nil feature text yields no findings (never throws)"
         []
         (gherkin-lint-gate-lib/find-continuation-line-findings nil))

;; ── find-phantom-column-findings ───────────────────────────────────────────

(def phantom-column-ir
  {:scenarios [{:name "wraps"
                :steps [{:keyword "Given" :text "a record with <telegram> Telegram"
                         :parameters ["telegram"]}
                        {:keyword "When" :text "something happens"}
                        {:keyword "Then" :text "it works"}]
                :examples [{:telegram "5" :total "10"}]}]})

(assert= "515-07: an Examples column referenced by no step parameter is flagged"
         [{:scenario "wraps" :column "total"}]
         (gherkin-lint-gate-lib/find-phantom-column-findings phantom-column-ir))

(def fully-referenced-ir
  {:scenarios [{:name "fully referenced"
                :steps [{:keyword "Given" :text "a value of <a>" :parameters ["a"]}
                        {:keyword "When" :text "it is combined with <b>" :parameters ["b"]}
                        {:keyword "Then" :text "the result is <c>" :parameters ["c"]}]
                :examples [{:a "1" :b "2" :c "3"}]}]})

(assert= "515-08: a fully-referenced Examples table has no phantom-column findings"
         []
         (gherkin-lint-gate-lib/find-phantom-column-findings fully-referenced-ir))

(def no-examples-ir
  {:scenarios [{:name "plain scenario, no Examples"
                :steps [{:keyword "Given" :text "a precondition"}]
                :examples []}]})

(assert= "515-09: a scenario with no Examples table has no phantom-column findings"
         []
         (gherkin-lint-gate-lib/find-phantom-column-findings no-examples-ir))

;; BL-259/BL-374 regression: a column name containing a space or a hyphen
;; is referenced via its literal <token> in step TEXT even though the
;; vendored parser's own :parameters IR field silently omits such names
;; (confirmed against the real parser: it emits no "parameters" key at all
;; for a hyphenated placeholder like <work-dir-form>). Reading step text
;; directly - the same source specs/pipeline/runtime.js's substitute()
;; reads - must not flag these as phantom.
(def hyphen-and-space-column-ir
  {:scenarios [{:name "path resolution"
                :steps [{:keyword "When" :text "the caller passes a <work-dir-form> work directory"}
                        {:keyword "Then" :text "it is reported as violating the \"<forbidden edge>\" rule"}]
                :examples [{:work-dir-form "relative" :forbidden-edge-unused "x"}]}]})

;; note: the Examples column key here is intentionally NOT "forbidden edge"
;; (with a space) to keep this fixture's map-key syntax simple; the point
;; already proven above is that a hyphenated name like work-dir-form is
;; picked up from text, not from :parameters.
(assert= "515-13: a hyphenated column referenced only via its <token> in step text is not phantom"
         [{:scenario "path resolution" :column "forbidden-edge-unused"}]
         (gherkin-lint-gate-lib/find-phantom-column-findings hyphen-and-space-column-ir))

;; The claim in the comment above ("proven already") was never actually
;; exercised for a SPACE-containing column name - only for a hyphenated one.
;; A space is a different character class through the regex/set-membership
;; path (param-token-re captures it into the same string; the Examples key
;; comes back as a keyword whose (name ...) also preserves the space), so
;; this closes that specific untested claim rather than taking it on faith.
(def space-column-ir
  {:scenarios [{:name "path resolution"
                :steps [{:keyword "Then" :text "it is reported as violating the \"<forbidden edge>\" rule"}]
                :examples [{(keyword "forbidden edge") "x"}]}]})

(assert= "515-19: a column name containing a space, referenced via its <token> in step text, is not phantom"
         []
         (gherkin-lint-gate-lib/find-phantom-column-findings space-column-ir))

(def background-referenced-ir
  {:background [{:keyword "Given" :text "the wrapper is run with <mode>"}]
   :scenarios [{:name "background reference"
                :steps [{:keyword "Then" :text "it succeeds"}]
                :examples [{:mode "relative"}]}]})

(assert= "515-14: a column referenced only from a Background step's text is not phantom"
         []
         (gherkin-lint-gate-lib/find-phantom-column-findings background-referenced-ir))

;; ── lint-findings / clean? ──────────────────────────────────────────────────

(assert= "515-10: lint-findings combines both signatures"
         {:continuation-lines [{:line 5 :text "events out of <total> total events"}]
          :phantom-columns [{:scenario "wraps" :column "total"}]}
         (gherkin-lint-gate-lib/lint-findings param-wrapped-step-feature phantom-column-ir))

(assert= "515-11: clean? is false when either signature has findings"
         false
         (gherkin-lint-gate-lib/clean?
          (gherkin-lint-gate-lib/lint-findings param-wrapped-step-feature phantom-column-ir)))

(assert= "515-12: clean? is true when a feature has neither signature"
         true
         (gherkin-lint-gate-lib/clean?
          (gherkin-lint-gate-lib/lint-findings clean-single-line-feature fully-referenced-ir)))

;; ── BL-520: legacy wrap exemptions are drained ────────────────────────────

(assert= "520-01: continuation-line findings are no longer suppressible by path"
         [{:line 5 :text "events out of <total> total events"}]
         (:continuation-lines
          (gherkin-lint-gate-lib/lint-findings param-wrapped-step-feature fully-referenced-ir)))

(assert= "520-02: clean? stays false for a wrapped file even when every Examples column is referenced"
         false
         (gherkin-lint-gate-lib/clean?
          (gherkin-lint-gate-lib/lint-findings param-wrapped-step-feature fully-referenced-ir)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: gherkin_lint_gate_lib.bb"))
