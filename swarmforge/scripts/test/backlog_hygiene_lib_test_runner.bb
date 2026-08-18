#!/usr/bin/env bb
;; Unit tests for backlog_hygiene_lib.bb (BL-544).

(ns backlog-hygiene-lib-test
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "backlog_hygiene_lib.bb")))

(defn assert= [msg expected actual]
  (when-not (= expected actual)
    (println (str "FAIL: " msg))
    (println (str "  expected: " (pr-str expected)))
    (println (str "  actual:   " (pr-str actual)))
    (System/exit 1))
  (println (str "PASS: " msg)))

(defn sample-slice-missing-epic []
  "id: BL-999
title: test slice
type: feature
priority: 5
")

(defn sample-epic-missing-milestone []
  "id: BL-998
title: EPIC test
type: epic
epic: test-epic
priority: 0
")

(defn sample-clean-slice []
  "id: BL-997
title: test slice
type: feature
epic: test-epic
milestone: M8
priority: 5
")

(defn sample-clean-epic []
  "id: BL-996
title: EPIC test
type: epic
epic: test-epic
milestone: M8
priority: 0
")

(assert=
 "non-epic without epic is a missing-epic violation"
 [{:kind :missing-epic :id "BL-999" :path "fixture.yaml"}]
 (backlog-hygiene-lib/violations-for-text (sample-slice-missing-epic) {:id "BL-999" :path "fixture.yaml"}))

(assert=
 "epic without milestone is a missing-milestone violation"
 [{:kind :missing-milestone :id "BL-998" :path "fixture.yaml"}]
 (backlog-hygiene-lib/violations-for-text (sample-epic-missing-milestone) {:id "BL-998" :path "fixture.yaml"}))

(assert=
 "clean slice has no violations"
 []
 (backlog-hygiene-lib/violations-for-text (sample-clean-slice) {:id "BL-997" :path "fixture.yaml"}))

(assert=
 "clean epic has no violations"
 []
 (backlog-hygiene-lib/violations-for-text (sample-clean-epic) {:id "BL-996" :path "fixture.yaml"}))

;; ── BL-922: unreadable-acceptance (block scalar hiding a feature pointer) ──

(defn sample-block-scalar-hiding-feature [indicator]
  (str "id: BL-995
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: " indicator "
  specs/features/BL-042-example.feature
  (some prose about the contract)
priority: 5
"))

(doseq [indicator ["|" "|-" "|+" ">" ">-"]]
  (assert=
   (str "block scalar '" indicator "' hiding a feature pointer is an unreadable-acceptance violation")
   [{:kind :unreadable-acceptance :id "BL-995" :path "fixture.yaml"
     :feature-path "specs/features/BL-042-example.feature"}]
   (backlog-hygiene-lib/violations-for-text (sample-block-scalar-hiding-feature indicator) {:id "BL-995" :path "fixture.yaml"})))

(defn sample-single-line-pointer []
  "id: BL-994
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: specs/features/BL-042-example.feature
priority: 5
")

(assert=
 "a single-line pointer is not an unreadable-acceptance violation"
 []
 (backlog-hygiene-lib/violations-for-text (sample-single-line-pointer) {:id "BL-994" :path "fixture.yaml"}))

(defn sample-block-scalar-honest-placeholder []
  "id: BL-993
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: |
  Specifier writes the scenarios. Minimum:
  - covers the happy path
priority: 5
")

(assert=
 "a block scalar naming no feature file is not an unreadable-acceptance violation"
 []
 (backlog-hygiene-lib/violations-for-text (sample-block-scalar-honest-placeholder) {:id "BL-993" :path "fixture.yaml"}))

(defn sample-block-scalar-glob-mention []
  "id: BL-990
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: |
  Not yet drafted as a feature file - blocked on a human ruling. Once ruled,
  specifier returns to write specs/features/BL-990-*.feature covering the
  contract.
priority: 5
")

(assert=
 "a glob-shaped mention (BL-990-*.feature) previewing a not-yet-written file is not a real pointer (BL-555/BL-588 regression)"
 []
 (backlog-hygiene-lib/violations-for-text (sample-block-scalar-glob-mention) {:id "BL-990" :path "fixture.yaml"}))

(defn sample-no-acceptance-field []
  "id: BL-992
title: test slice
type: feature
epic: test-epic
milestone: M8
priority: 5
")

(assert=
 "an absent acceptance: field is not an unreadable-acceptance violation"
 []
 (backlog-hygiene-lib/violations-for-text (sample-no-acceptance-field) {:id "BL-992" :path "fixture.yaml"}))

(assert=
 "format-violation names the ticket id, path, and hidden feature path"
 true
 (boolean (re-find #"BL-995.*fixture\.yaml.*specs/features/BL-042-example\.feature"
                    (backlog-hygiene-lib/format-violation
                     {:kind :unreadable-acceptance :id "BL-995" :path "fixture.yaml"
                      :feature-path "specs/features/BL-042-example.feature"}))))

(println "backlog_hygiene_lib_test: all passed")
