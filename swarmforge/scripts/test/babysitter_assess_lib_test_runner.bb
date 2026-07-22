#!/usr/bin/env bb
;; TDD runner for babysitter_assess_lib.bb — no tmux, no network.
(ns babysitter-assess-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_assess_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(let [now 1000000
      cfg claim-progress-lib/default-config
      base {:role "coder"
            :worktree-path "/tmp"
            :sidecar-path "/tmp/x.handoff.claim-progress.json"
            :now-ms now
            :config cfg}]
  (assert= "ok when fresh claim"
           "ok"
           (:severity (babysitter-assess-lib/assess-one-claim
                        (assoc base
                               :progress {:claimCommit "aaaa" :claimAtMs (- now 1000) :reclaims 0}
                               :worktree-path "/nonexistent"))))

  (assert-true "warn at reclaims=4"
               (= "warn"
                  (:severity (babysitter-assess-lib/assess-one-claim
                              (assoc base
                                     :progress {:claimCommit "aaaa" :claimAtMs (- now 100000) :reclaims 4}
                                     :worktree-path "/nonexistent")))))

  (assert-true "critical at bounce threshold"
               (= "critical"
                  (:severity (babysitter-assess-lib/assess-one-claim
                              (assoc base
                                     :progress {:claimCommit "aaaa" :claimAtMs (- now 100000) :reclaims 6}
                                     :worktree-path "/nonexistent")))))

  (assert-true "alert-severity filters ok"
               (and (babysitter-assess-lib/alert-severity? "warn")
                    (babysitter-assess-lib/alert-severity? "critical")
                    (not (babysitter-assess-lib/alert-severity? "ok"))
                    (not (babysitter-assess-lib/alert-severity? "watch")))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "babysitter_assess_lib_test_runner: ok")
