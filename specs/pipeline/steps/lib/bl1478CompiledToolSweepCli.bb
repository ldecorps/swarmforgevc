#!/usr/bin/env bb
;; BL-1478 acceptance driver: drives the REAL
;; daemon-cycle-guard-lib/run-compiled-tool! (swarmforge/scripts/daemon_cycle_guard_lib.bb)
;; against a JSON-described fixture (stdin in, JSON out on stdout) - never a
;; reimplementation. The feature's Background ("with its shell and log seams
;; injected") is exactly the lib's own 5-arity form: a fake sh-fn returns the
;; drawn {exit, out, err} in place of a real subprocess, and log-fn captures
;; every call in-process instead of hitting a real daemon log file.
;;
;; Input JSON: {sweep, exit, stdout, stderr}
;; Output JSON: {logged: [[event, detail], ...]}

(ns bl1478-compiled-tool-sweep-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "daemon_cycle_guard_lib.bb")))

(defn -main []
  (let [input (json/parse-string (slurp *in*) true)
        sweep (:sweep input)
        exit (:exit input)
        stdout (or (:stdout input) "")
        stderr (or (:stderr input) "")
        logged (atom [])
        log-fn (fn [event detail] (swap! logged conj [event detail]))]
    (daemon-cycle-guard-lib/run-compiled-tool!
     log-fn sweep ["node" "fixture.js"] {}
     (fn [_cmd _opts] {:exit exit :out stdout :err stderr}))
    (println (json/generate-string {:logged @logged}))))

(-main)
