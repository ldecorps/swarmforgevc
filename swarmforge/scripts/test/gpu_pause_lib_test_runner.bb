#!/usr/bin/env bb
(ns gpu-pause-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "gpu_pause_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg " expected " (pr-str expected) " actual " (pr-str actual)))))

(require '[gpu-pause-lib :as g])

(assert= "30m" (* 30 60 1000) (g/duration-ms-for "30m"))
(assert= "1h" (* 60 60 1000) (g/duration-ms-for "1h"))
(assert= "2h" (* 2 60 60 1000) (g/duration-ms-for "2h"))
(assert= "unknown duration" nil (g/duration-ms-for "4h"))
(assert= "active and still ahead" true (g/pause-active? {:active true :untilMs 200} 100))
(assert= "expired is quiet over" false (g/pause-active? {:active true :untilMs 100} 100))
(assert= "cleared marker" false (g/pause-active? {:active false :untilMs 999} 1))
(assert= "missing until is not an open-ended pause" false (g/pause-active? {:active true} 1))
(assert= "local-model seat" true (g/local-model-seat? "local-model"))
(assert= "claude seat" false (g/local-model-seat? "claude"))

(when (seq @failures)
  (binding [*out* *err*] (doseq [f @failures] (println f)))
  (System/exit 1))
(println "gpu_pause_lib_test_runner: ok")
