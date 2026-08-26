#!/usr/bin/env bb
;; BL-1102 scenario 04: two sequential sh! calls — first an unspawnable
;; binary (what tmux! would hit with PATH stripped), then a real command.
;; Proves the chokepoint returns so a delivery tick can continue, without
;; standing up a live handoffd/tmux.
(ns bl1102-spawn-failure-harness
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_cycle_guard_lib.bb")))

(defn tick-shell!
  "One delivery-tick-shaped shell-out (same chokepoint as handoffd's tmux!)."
  [cmd]
  (daemon-cycle-guard-lib/sh! cmd))

(let [r1 (try
           (tick-shell! "definitely-not-on-path-bl1102-delivery")
           (catch Throwable t
             (println "THROWN" (.getMessage t))
             (System/exit 2)))]
  (when-not (:spawn-failed? r1)
    (println "EXPECTED_SPAWN_FAIL" (pr-str r1))
    (System/exit 1))
  (println "SPAWN_FAIL" (:exit r1)))

(let [r2 (try
           (tick-shell! ["echo" "further"])
           (catch Throwable t
             (println "THROWN" (.getMessage t))
             (System/exit 2)))]
  (when-not (and (zero? (:exit r2)) (str/includes? (:out r2) "further"))
    (println "FURTHER_TICK_BAD" (pr-str r2))
    (System/exit 1))
  (println "FURTHER_TICK_OK"))
