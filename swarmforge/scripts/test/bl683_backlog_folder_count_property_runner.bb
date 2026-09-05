#!/usr/bin/env bb
;; BL-683 / BL-654: every counter that reports the size of a backlog folder
;; counts ticket YAML files only, and all of them agree on the same folder.
;; Quantifies over ticket counts and non-ticket litter (.gitkeep, .md, dirs).
(ns bl683-backlog-folder-count-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(load-file (str (fs/path scripts-dir "backlog_depth_lib.bb")))
(load-file (str (fs/path scripts-dir "chase_sweep_lib.bb")))

(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn status-snapshot-count
  "Same filter as handoffd's count-yaml-files."
  [dir]
  (if (fs/exists? dir)
    (count (filter #(str/ends-with? (fs/file-name %) ".yaml") (fs/list-dir dir)))
    0))

(defn populate! [dir n-tickets]
  (fs/create-dirs dir)
  (spit (str (fs/path dir ".gitkeep")) "")
  (spit (str (fs/path dir "README.md")) "not a ticket\n")
  (fs/create-dirs (fs/path dir "nested"))
  (doseq [i (range n-tickets)]
    (spit (str (fs/path dir (str "BL-" i "-t.yaml"))) (str "id: BL-" i "\n"))))

(doseq [n [0 1 2 4 7]]
  (let [root (str (fs/create-temp-dir {:prefix "bl683-prop-"}))
        _ (swap! created-temp-dirs conj root)
        active (str (fs/path root "backlog" "active"))]
    (populate! active n)
    (let [a (backlog-depth-lib/count-active-tickets active)
          b (chase-sweep-lib/count-backlog-yaml active)
          c (status-snapshot-count active)]
      (assert= (str "count-active-tickets = " n) n a)
      (assert= (str "count-backlog-yaml = " n) n b)
      (assert= (str "status-snapshot = " n) n c)
      (assert= "three counters agree" a b)
      (assert= "status agrees with warning counter" a c))))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))
(println "bl683_backlog_folder_count_property_runner: ALL PROPERTIES HOLD")
