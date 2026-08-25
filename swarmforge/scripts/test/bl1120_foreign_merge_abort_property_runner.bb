#!/usr/bin/env bb
;; BL-1120 invariants over merge-attempt-plan / may-abort-failed-merge?.

(ns bl1120-foreign-merge-abort-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))
(defn assert! [msg ok]
  (when-not ok (swap! failures conj msg)))

(assert! "pre-existing MERGE_HEAD plans skip"
         (= :skip-human-merge-in-progress
            (master-main-reconcile-lib/merge-attempt-plan true)))
(assert! "clean checkout plans run-merge"
         (= :run-merge (master-main-reconcile-lib/merge-attempt-plan false)))
(assert! "tick-started merge may abort"
         (master-main-reconcile-lib/may-abort-failed-merge? true))
(assert! "foreign MERGE_HEAD must not abort"
         (not (master-main-reconcile-lib/may-abort-failed-merge? false)))

(when (seq @failures)
  (doseq [f @failures] (println (str "FAIL: " f)))
  (System/exit 1))
(println "bl1120_foreign_merge_abort_property_runner: ALL PROPERTIES HOLD")
