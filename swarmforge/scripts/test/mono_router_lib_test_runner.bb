#!/usr/bin/env bb
;; TDD runner for mono_router_lib.bb
(ns mono-router-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def roles ["coder" "specifier" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(assert-true "conf detects rotation router"
             (mono-router-lib/conf-rotation-router?
              "config active_backlog_max_depth 1\nconfig rotation router\nwindow coder aider\n"))
(assert-true "conf without rotation is false"
             (not (mono-router-lib/conf-rotation-router?
                   "config active_backlog_max_depth -1\nwindow coder aider\n")))

(assert= "coder is resident" :resident (mono-router-lib/classify-role roles "coder"))
(assert= "coordinator stands" :coordinator (mono-router-lib/classify-role roles "coordinator"))
(assert= "QA dormant" :dormant (mono-router-lib/classify-role roles "QA"))
(assert= "specifier dormant" :dormant (mono-router-lib/classify-role roles "specifier"))

(assert-true "resident should stand"
             (mono-router-lib/should-have-standing-session? roles "coder"))
(assert-true "QA should not stand"
             (not (mono-router-lib/should-have-standing-session? roles "QA")))

(assert= "illicit standing QA"
         :teardown-illicit
         (mono-router-lib/topology-action roles "QA" true))
(assert= "missing resident"
         :ensure-standing
         (mono-router-lib/topology-action roles "coder" false))
(assert= "dormant missing ok"
         :dormant-ok
         (mono-router-lib/topology-action roles "specifier" false))
(assert= "coordinator ok"
         :ok
         (mono-router-lib/topology-action roles "coordinator" true))

(let [sum (mono-router-lib/summarize-topology
           roles
           [{:role "coder" :alive? false}
            {:role "QA" :alive? true}
            {:role "coordinator" :alive? true}])]
  (assert= "one illicit" 1 (count (:illicit sum)))
  (assert= "one missing standing" 1 (count (:missing-standing sum))))

(assert-true "identity rotation=router"
             (mono-router-lib/rotation-router-from-identity?
              "swarm_name\tprimary\nrotation\trouter\n"))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "mono_router_lib_test_runner: ok")
