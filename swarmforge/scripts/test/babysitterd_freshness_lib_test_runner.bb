#!/usr/bin/env bb
;; TDD runner for babysitterd_freshness_lib.bb — Operator tell-don't-restart
;; classify + cmdline matcher. No ps, no fs, no clock: every input injected.
(ns babysitterd-freshness-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitterd_freshness_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(defn assert-false [msg expr]
  (when expr (swap! failures conj (str "FAIL: " msg))))

(require '[babysitterd-freshness-lib :as bf])

(def root "/Users/ldecorps/projects/swarmforgevc")

;; ── daemon-cmdline? ──────────────────────────────────────────────────────────
(assert-true "looping daemon with root in argv matches"
             (bf/daemon-cmdline?
              (str "bash /opt/swarmforge/scripts/babysitterd.sh " root)
              root))
(assert-true "absolute daemon path without bash prefix matches"
             (bf/daemon-cmdline? (str root "/swarmforge/scripts/babysitterd.sh " root) root))
(assert-false "start_babysitterd.sh is never the daemon (suffix collision)"
              (bf/daemon-cmdline?
               (str "bash /opt/swarmforge/scripts/start_babysitterd.sh " root)
               root))
(assert-false "--tick-once is a test helper, not the looping daemon"
              (bf/daemon-cmdline?
               (str "bash /opt/swarmforge/scripts/babysitterd.sh " root " --tick-once")
               root))
(assert-false "another project root does not match"
              (bf/daemon-cmdline?
               "bash /opt/swarmforge/scripts/babysitterd.sh /tmp/other-swarm"
               root))
(assert-false "empty cmdline never matches"
              (bf/daemon-cmdline? "" root))
(assert-false "blank root never matches (would be a glob)"
              (bf/daemon-cmdline?
               (str "bash /opt/swarmforge/scripts/babysitterd.sh " root)
               ""))

;; ── find-live-pid / resolve-live-pid ───────────────────────────────────────
(let [procs [{:pid 11 :cmdline "sleep 30"}
             {:pid 22 :cmdline (str "bash /x/start_babysitterd.sh " root)}
             {:pid 33 :cmdline (str "bash /x/babysitterd.sh " root)}
             {:pid 44 :cmdline (str "bash /x/babysitterd.sh " root " --tick-once")}]]
  (assert= "find-live-pid skips starter and tick-once" 33 (bf/find-live-pid root procs))
  (assert= "find-live-pid nil on empty" nil (bf/find-live-pid root [])))

(assert= "pidfile wins when alive" 7 (bf/resolve-live-pid 7 true 33))
(assert= "orphan used when pidfile is dead" 33 (bf/resolve-live-pid 7 false 33))
(assert= "nil when neither" nil (bf/resolve-live-pid nil false nil))
(assert= "stale pidfile + no orphan is nil" nil (bf/resolve-live-pid 7 false nil))

;; ── classify: never :restart ───────────────────────────────────────────────
(assert= "disabled when skip/enabled? false"
         "disabled"
         (:state (bf/classify {:enabled? false :live-pid 1 :pidfile-alive? true :telegram-creds? true})))
(assert= "disabled action is none"
         :none
         (:action (bf/classify {:enabled? false :live-pid nil :pidfile-alive? false :telegram-creds? false})))

(let [down (bf/classify {:enabled? true :live-pid nil :pidfile-alive? false :telegram-creds? true})]
  (assert= "no process is down" "down" (:state down))
  (assert= "down tells, never restarts" :tell (:action down))
  (assert-true "down finding names Operator will not spawn" (boolean (re-find #"will not spawn" (str (:finding down))))))

(let [lie (bf/classify {:enabled? true :live-pid 38002 :pidfile-alive? false :telegram-creds? true})]
  (assert= "live process + dead pidfile is pidfile-lie" "pidfile-lie" (:state lie))
  (assert= "pidfile-lie tells" :tell (:action lie))
  (assert-true "finding names the live pid" (boolean (re-find #"38002" (str (:finding lie)))))
  (assert-true "finding names adopt, not spawn" (boolean (re-find #"adopt" (str (:finding lie))))))

(let [mute (bf/classify {:enabled? true :live-pid 9 :pidfile-alive? true :telegram-creds? false})]
  (assert= "alive+pidfile but no telegram is announce-mute" "announce-mute" (:state mute))
  (assert= "announce-mute tells" :tell (:action mute)))

(let [ok (bf/classify {:enabled? true :live-pid 9 :pidfile-alive? true :telegram-creds? true})]
  (assert= "process+pidfile+creds is healthy" "healthy" (:state ok))
  (assert= "healthy never tells" :none (:action ok))
  (assert= "healthy has no finding" nil (:finding ok)))

;; down wins over announce-mute (no process, also no creds)
(assert= "down beats announce-mute when both would apply"
         "down"
         (:state (bf/classify {:enabled? true :live-pid nil :pidfile-alive? false :telegram-creds? false})))

;; pidfile-lie wins over announce-mute
(assert= "pidfile-lie beats announce-mute"
         "pidfile-lie"
         (:state (bf/classify {:enabled? true :live-pid 1 :pidfile-alive? false :telegram-creds? false})))

;; ── should-alert? cooldown ─────────────────────────────────────────────────
(let [tell {:action :tell :state "down"}
      quiet {:action :none :state "healthy"}]
  (assert-true "first tell always alerts" (bf/should-alert? tell nil 1000 30000))
  (assert-false "healthy never alerts" (bf/should-alert? quiet nil 1000 30000))
  (assert-false "inside cooldown does not re-alert" (bf/should-alert? tell 900 1000 30000))
  (assert-true "past cooldown re-alerts" (bf/should-alert? tell 900 40000 30000)))

;; Guard: classify never returns :restart (the whole point of this lib).
(doseq [snap [{:enabled? false}
              {:enabled? true :live-pid nil :pidfile-alive? false :telegram-creds? false}
              {:enabled? true :live-pid 1 :pidfile-alive? false :telegram-creds? false}
              {:enabled? true :live-pid 1 :pidfile-alive? true :telegram-creds? false}
              {:enabled? true :live-pid 1 :pidfile-alive? true :telegram-creds? true}]]
  (assert-true (str "classify never :restart for " (pr-str snap))
               (not= :restart (:action (bf/classify snap)))))

(when (seq @failures)
  (println (str/join "\n" @failures))
  (println (str (count @failures) " failure(s)"))
  (System/exit 1))
(println "babysitterd_freshness_lib_test_runner: ok")
