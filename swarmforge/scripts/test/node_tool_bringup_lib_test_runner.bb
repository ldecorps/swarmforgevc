#!/usr/bin/env bb
;; BL-1010: the compiled-tool bring-up message names the step, not the artifact.

(ns node-tool-bringup-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "node_tool_bringup_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(let [m (node-tool-bringup-lib/missing-tool-message
          "emit-fleet-status.js" "/repo/extension/out/tools/emit-fleet-status.js")]
  (assert-true "bl1010: the message names the tool that could not run"
               (str/includes? m "emit-fleet-status.js"))
  (assert-true "bl1010: the message names the COMMAND to run, which is the thing that was missing"
               (str/includes? m "npm run compile"))
  (assert-true "bl1010: and the directory to run it in - npm runs from extension/, never the repo root"
               (str/includes? m "extension/"))
  (assert-true "bl1010: the message is recognised by its own gate" (node-tool-bringup-lib/names-bring-up-step? m)))

;; The defect shape, stated as a test: a message that names ONLY the missing
;; artifact is what handoffd reported every cycle, and it must not pass.
(assert-false "bl1010: a bare module-not-found naming only the artifact does NOT count as naming the bring-up step"
              (node-tool-bringup-lib/names-bring-up-step?
                "Error: Cannot find module '/repo/extension/out/tools/emit-fleet-status.js'"))
(assert-false "bl1010: a non-string is never a bring-up message" (node-tool-bringup-lib/names-bring-up-step? nil))

(if (empty? @failures)
  (println "ALL PASS: node_tool_bringup_lib.bb")
  (do (doseq [f @failures] (println f)) (System/exit 1)))
