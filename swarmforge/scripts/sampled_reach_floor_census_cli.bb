#!/usr/bin/env bb
;; sampled_reach_floor_census_cli.bb — BL-1584: one TSV row per property test
;; file (file<TAB>verdict<TAB>budget), from the SAME classifier the send-time
;; gate uses (sampled_reach_floor_guard_lib.bb/classify — never a second
;; notion of reach floor, construction, or budget, invariant 2), plus a
;; trailing summary line with the count per verdict.
;;
;; Usage: bb sampled_reach_floor_census_cli.bb <project-root>
;;
;; Replaces the mint-time greps recorded in
;; backlog/evidence/BL-1583-sampled-reach-floor-census-20260915.md; the sweep
;; slices' evidence and QA's e2e cite this CLI's own output instead.

(ns sampled-reach-floor-census-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "sampled_reach_floor_guard_lib.bb")))

(defn census-row-for-text
  "Pure: one file's relative path and its already-slurped text -> a row map.
   The ONE place this CLI calls the classifier - census-rows below and any
   test that wants to compare the CLI's own answer against the gate's must
   go through here, never a second read of classify's fields."
  [rel-path text]
  (let [{:keys [verdict budget]} (sampled-reach-floor-guard-lib/classify text)]
    {:file rel-path
     :verdict (name verdict)
     :budget (if (keyword? budget) (name budget) (str budget))}))

(defn- property-test-files [root]
  (->> (fs/glob (fs/path root sampled-reach-floor-guard-lib/property-test-dir) "*.property.test.js")
       (sort-by str)))

(defn census-rows
  "One row per extension/test/*.property.test.js file under root, sorted by
   path - the impure walk, delegating every decision to census-row-for-text."
  [root]
  (vec
   (for [f (property-test-files root)
         :let [rel (str (fs/relativize (fs/path root) f))]]
     (census-row-for-text rel (slurp (str f))))))

(defn summary-line
  "Pure: rows -> the trailing 'SUMMARY verdict=count ...' line, sorted by
   verdict name so the line is stable across runs."
  [rows]
  (let [by-verdict (frequencies (map :verdict rows))]
    (str "SUMMARY " (str/join " " (map (fn [[k v]] (str k "=" v)) (sort by-verdict))))))

(defn -main [args]
  (let [[root] args]
    (if (str/blank? root)
      (do (binding [*out* *err*]
            (println "usage: sampled_reach_floor_census_cli.bb <project-root>"))
          (System/exit 2))
      (let [rows (census-rows root)]
        (doseq [{:keys [file verdict budget]} rows]
          (println (str file "\t" verdict "\t" budget)))
        (println (summary-line rows))))))

;; Safe to load-file (a pure library load, same guard convention as every
;; sibling *_cli.bb in this tree); runs -main only when this file is the one
;; bb was invoked with directly.
(when (= *file* (System/getProperty "babashka.file"))
  (-main *command-line-args*))
