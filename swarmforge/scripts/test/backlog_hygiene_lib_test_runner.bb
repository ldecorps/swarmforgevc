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

(println "backlog_hygiene_lib_test: all passed")
