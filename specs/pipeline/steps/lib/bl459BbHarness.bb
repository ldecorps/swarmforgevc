#!/usr/bin/env bb
;; BL-459 tempdir-cleanup-trap-01: a minimal demonstration babashka harness
;; using the REAL shutdown-hook mechanism the 11 real *_test_runner.bb files
;; now use (never a hand-rolled substitute). Usage: bb bl459BbHarness.bb
;; <clean|failing>. Prints the created root's path to stdout before exiting.
(require '[babashka.fs :as fs])

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl459-bb-harness-"}))]
    (swap! created-temp-dirs conj d)
    d))

(def mode (first *command-line-args*))
(when-not (#{"clean" "failing"} mode)
  (binding [*out* *err*] (println "usage: bl459BbHarness.bb <clean|failing>"))
  (System/exit 2))

(println (mk-tmp))

(if (= mode "failing")
  (System/exit 1)
  (System/exit 0))
