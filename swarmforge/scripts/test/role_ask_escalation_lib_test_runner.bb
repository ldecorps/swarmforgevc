#!/usr/bin/env bb
;; GH-25: unit tests for role_ask_escalation_lib.bb (pure).
(ns role-ask-escalation-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "role_ask_escalation_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def now 1700000000000)
(def thresh (role-ask-escalation-lib/threshold-ms 30))

(assert= "default threshold minutes"
         30
         (role-ask-escalation-lib/parse-threshold-minutes nil))
(assert= "parse positive minutes"
         5
         (role-ask-escalation-lib/parse-threshold-minutes "5"))
(assert= "junk → default"
         30
         (role-ask-escalation-lib/parse-threshold-minutes "nope"))

(assert= "31m past 30m → posted-and-stamped"
         :posted-and-stamped
         (role-ask-escalation-lib/decide-escalation-outcome
          {:asked_at_ms (- now (* 31 60 1000))} now thresh))
(assert= "10m under 30m → none"
         :none
         (role-ask-escalation-lib/decide-escalation-outcome
          {:asked_at_ms (- now (* 10 60 1000))} now thresh))
(assert= "prior stamp → none even if ancient"
         :none
         (role-ask-escalation-lib/decide-escalation-outcome
          {:asked_at_ms (- now (* 90 60 1000))
           :escalated_at_ms (- now (* 60 60 1000))}
          now thresh))
(assert= "custom 5m threshold, age 6 → posted"
         :posted-and-stamped
         (role-ask-escalation-lib/decide-escalation-outcome
          {:asked_at_ms (- now (* 6 60 1000))}
          now
          (role-ask-escalation-lib/threshold-ms 5)))

(assert= "stamp adds escalated_at_ms"
         {:asked_at_ms 1 :question "q" :escalated_at_ms now}
         (role-ask-escalation-lib/stamp-escalated {:asked_at_ms 1 :question "q"} now))

(assert= "mention body names handle + role"
         true
         (let [b (role-ask-escalation-lib/format-mention-body "coder" "Need a ruling?")]
           (and (clojure.string/includes? b "@ldecorps")
                (clojure.string/includes? b "coder")
                (clojure.string/includes? b "Need a ruling?"))))

(assert= "undeliverable marker still due (delivery-independent)"
         :posted-and-stamped
         (role-ask-escalation-lib/decide-escalation-outcome
          {:asked_at_ms (- now (* 31 60 1000))
           :state "undeliverable"
           :question "dropped?"}
          now thresh))

(let [rendered (role-ask-escalation-lib/render-role-questions
                {"coder" {:asked_at_ms (- now (* 31 60 1000))
                          :question "q1"
                          :escalated_at_ms now}
                 "QA" {:asked_at_ms (- now (* 5 60 1000))
                       :question "q2"}}
                now thresh)]
  (assert= "stamped role surfaces escalated"
           "escalated"
           (get-in rendered ["coder" :state]))
  (assert= "fresh role surfaces pending"
           "pending"
           (get-in rendered ["QA" :state])))

(assert= "ops issue digits ok"
         "42"
         (role-ask-escalation-lib/parse-ops-issue " 42 "))
(assert= "ops issue junk → nil"
         nil
         (role-ask-escalation-lib/parse-ops-issue "abc"))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "role_ask_escalation_lib: ALL TESTS PASSED"))
