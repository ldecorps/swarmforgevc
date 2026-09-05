#!/usr/bin/env bb
;; Unit tests for daemon_log_freshness_pulse_lib.bb (BL-784).

(ns daemon-log-freshness-pulse-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_log_freshness_pulse_lib.bb")))

(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(let [root (fs/create-temp-dir)
      _ (swap! created-temp-dirs conj root)
      log (fs/path root "supervisor.log")]
  (daemon-log-freshness-pulse-lib/append-log-heartbeat! log)
  (daemon-log-freshness-pulse-lib/append-log-heartbeat! log)
  (let [text (slurp (str log))
        lines (filter #(clojure.string/includes? % "heartbeat") (str/split-lines text))]
    (assert= "append-log-heartbeat writes timestamped heartbeat lines" 2 (count lines))
    (assert-true "heartbeat line is ISO-timestamped"
                 (re-find #"^\d{4}-\d{2}-\d{2}T.*Z heartbeat$" (first lines)))))

(when (seq @failures)
  (binding [*out* *err*] (doseq [f @failures] (println f)))
  (System/exit 1))

(println "ALL PASS: daemon_log_freshness_pulse_lib.bb")
