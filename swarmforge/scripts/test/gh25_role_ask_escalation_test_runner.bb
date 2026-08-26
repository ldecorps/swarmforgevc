#!/usr/bin/env bb
;; GH-25: fixture IO for escalate-role-ask-markers! via operator_runtime helpers
;; loaded in isolation — posts through fake `gh` on PATH.
(ns gh25-role-ask-escalation-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "role_ask_escalation_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created] (try (fs/delete-tree d) (catch Exception _ nil))))))
(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "gh25-"}))]
    (swap! created conj d) d))

;; Pure decide matrix already covered; here stamp + mention body + ops issue.
(let [now 1700000000000
      thresh (role-ask-escalation-lib/threshold-ms 30)
      root (mk-tmp)
      awaiting (fs/path root ".swarmforge" "operator" "role-awaiting")
      _ (fs/create-dirs awaiting)
      marker {:question "Need a ruling on X?" :asked_at_ms (- now (* 31 60 1000))}
      path (str (fs/path awaiting "coder.json"))
      _ (spit path (json/generate-string marker))
      outcome (role-ask-escalation-lib/decide-escalation-outcome marker now thresh)
      stamped (role-ask-escalation-lib/stamp-escalated marker now)
      _ (spit path (json/generate-string stamped))
      reread (json/parse-string (slurp path) true)]
  (assert= "due → posted-and-stamped" :posted-and-stamped outcome)
  (assert= "stamp persisted" now (:escalated_at_ms reread))
  (assert= "second decide none" :none
           (role-ask-escalation-lib/decide-escalation-outcome reread now thresh))
  (assert= "mention body"
           true
           (str/includes? (role-ask-escalation-lib/format-mention-body "coder" (:question marker))
                          "@ldecorps")))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "gh25_role_ask_escalation: ALL TESTS PASSED"))
