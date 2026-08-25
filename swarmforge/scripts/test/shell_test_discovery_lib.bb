#!/usr/bin/env bb
;; BL-724: shell-test discovery — every test_*.sh under scripts/test is
;; reached, excluded-with-reason, or reported as a loud failure (never silence).
;; Builds on BL-973 suite_inventory_lib for manifest parsing; adds git-tracked
;; vs untracked orphan distinction the inventory gate alone does not label.
(ns shell-test-discovery-lib
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "suite_inventory_lib.bb")))

(defn shell-test-name?
  [name]
  (and (str/starts-with? name "test_") (str/ends-with? name ".sh")))

(defn- git-lines [repo-root & args]
  (let [{:keys [exit out]} (apply sh/sh (concat ["git" "-C" repo-root] args))]
    (when (zero? exit)
      (->> (str/split-lines (or out ""))
           (remove str/blank?)
           (map (fn [p]
                  (let [n (fs/file-name p)]
                    (when (shell-test-name? n) n))))
           (remove nil?)
           set))))

(defn tracked-shell-tests
  "test_*.sh tracked under swarmforge/scripts/test/ (git ls-files)."
  [repo-root]
  (or (git-lines repo-root "ls-files" "--" "swarmforge/scripts/test/test_*.sh") #{}))

(defn untracked-shell-tests
  "Untracked (and not gitignored) test_*.sh under scripts/test/."
  [repo-root]
  (or (git-lines repo-root "ls-files" "--others" "--exclude-standard" "--"
                 "swarmforge/scripts/test/test_*.sh")
      #{}))

(def ^:private inventory-label-rewrites
  [["not in the manifest: " "unaccounted test: "]
   ["excluded without a reason: " "exclusion missing its reason: "]
   ["in the manifest but not in the tree: " "stale exclusion: "]])

(defn- relabel-inventory-problem
  [problem]
  (or (some (fn [[from to]]
              (when (str/starts-with? problem from)
                (str to (subs problem (count from)))))
            inventory-label-rewrites)
      problem))

(defn check-discovery
  "Pure-ish verdict given tracked set, untracked set, and manifest rows.
   Returns problem strings (empty = clean). Shell-test rows only — .bb
   runners stay under the suite-inventory gate."
  [tracked untracked rows]
  (let [shell-rows (filterv #(shell-test-name? (:file %)) rows)
        shell-base (suite-inventory-lib/check tracked shell-rows)
        orphan-probs (for [f (sort untracked)]
                       (str "untracked orphan: " f
                            " - track it, exclude it with a dated reason, or remove it"))
        relabeled (map relabel-inventory-problem shell-base)]
    (vec (concat relabeled orphan-probs))))

(defn account-label
  "How the sweep accounts for file, given clean check inputs."
  [file tracked untracked rows]
  (let [row (first (filter #(= file (:file %)) rows))]
    (cond
      (contains? untracked file) :untracked-orphan
      (and row (= "standing" (:lane row)) (contains? tracked file)) :reached
      (and row (= "excluded" (:lane row)) (contains? tracked file)) :excluded
      :else :unaccounted)))
