#!/usr/bin/env bb
;; BL-973 half 2: the suite-completeness gate, pure half. Every test file under a bb test
;; tree is either run by the standing suite or carries an explicit, dated
;; exclusion with a reason - a red test cannot sit unrun and unnoticed.
;;
;; It could sit unrun before this: no standing entry point ran
;; swarmforge/scripts/test/ as a suite at all, so when a stale fixture copy-list
;; turned test_lean_ledger_bb_wiring.sh red, nobody found out for days. Three
;; separate roles then independently rediscovered the same staleness, each
;; spending a pass proving it was pre-existing before being allowed to proceed.
;;
;; This is an INVENTORY check, not a run-everything suite, which is what the
;; ticket asked for: it compares the tree against the manifest and says nothing
;; about whether any test passes. Some tests here are legitimately slow or
;; live-only and belong in an exclusion lane with a stated reason, not on every
;; parcel's critical path.
;;
;; The CLI beside this file is a thin wrapper over these functions: discovery
;; is one directory listing, and everything that decides anything is pure and
;; directly testable (suite_inventory_lib_test_runner.bb).

(ns suite-inventory-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def manifest-name "suite-manifest.tsv")
(def valid-lanes #{"standing" "excluded"})
(def date-re #"^\d{4}-\d{2}-\d{2}$")

(defn test-file?
  "The two shapes this tree uses: a shell test and a Babashka test runner.
   Anything else here is a helper, a fixture, or a library, and is not a test
   the suite is expected to run."
  [name]
  (or (and (str/starts-with? name "test_") (str/ends-with? name ".sh"))
      (str/ends-with? name "_test_runner.bb")))

(defn discover-test-files
  "Test files directly in the tree. Not recursive: lib/ holds shared helpers,
   not tests, and a helper swept in as a test would be a false red."
  [dir]
  (->> (fs/list-dir dir)
       (filter fs/regular-file?)
       (map (comp str fs/file-name))
       (filter test-file?)
       set))

(defn parse-manifest
  "Rows as {:file :lane :date :reason}, skipping comments and blank lines.
   Malformed rows are returned too, with whatever fields parsed, so the caller
   reports them rather than silently dropping them - a dropped row would read
   as a missing file and send the reader hunting in the wrong place."
  [text]
  (->> (str/split-lines (or text ""))
       (remove #(or (str/blank? %) (str/starts-with? (str/trim %) "#")))
       (mapv (fn [line]
               (let [[file lane date reason] (str/split line #"\t" -1)]
                 {:file (str/trim (or file ""))
                  :lane (str/trim (or lane ""))
                  :date (str/trim (or date ""))
                  :reason (str/trim (or reason ""))
                  :raw line})))))

(defn check
  "Pure: the whole verdict, given the discovered set and the parsed rows.
   Returns a vector of human-readable problems, empty when the tree and the
   manifest agree."
  [discovered rows]
  (let [listed (map :file rows)
        listed-set (set listed)
        dupes (->> listed frequencies (keep (fn [[f n]] (when (> n 1) f))) sort)]
    (vec
     (concat
      (for [f (sort (remove listed-set discovered))]
        (str "not in the manifest: " f
             " - add a row (lane standing, or excluded with a date and a reason)"))
      ;; BL-1239: a row whose first column is not a test file name at all - a
      ;; ticket id, or a property runner, which has its own lane and is never a
      ;; suite member. Three such rows sat here registering nothing while
      ;; looking like registrations. Called out as MALFORMED rather than as a
      ;; missing file: "restore the file" sends the reader hunting for a file
      ;; that was never supposed to be here.
      (for [f (sort (remove test-file? listed-set))]
        (str "first column is not a test file name: " (pr-str f)
             " - column 1 must name a test_*.sh or *_test_runner.bb file"))
      (for [f (sort (filter test-file? (remove discovered listed-set)))]
        (str "in the manifest but not in the tree: " f
             " - delete the row, or restore the file"))
      (for [f dupes]
        (str "listed more than once: " f))
      (for [{:keys [file lane]} rows
            :when (not (valid-lanes lane))]
        (str "unknown lane " (pr-str lane) " for " file
             " - must be \"standing\" or \"excluded\""))
      (for [{:keys [file lane date]} rows
            :when (and (= "excluded" lane) (not (re-matches date-re date)))]
        (str "excluded without a valid YYYY-MM-DD date: " file
             " - an exclusion is a dated decision, not a permanent silence"))
      (for [{:keys [file lane reason]} rows
            :when (and (= "excluded" lane) (str/blank? reason))]
        (str "excluded without a reason: " file
             " - slow, manual and live-only are legitimate; say which"))))))
