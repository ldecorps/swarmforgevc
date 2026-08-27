#!/usr/bin/env bb
;; Test-only harness for briefing_generation_schedule_lib.bb's BL-272
;; :emit-sidecar! integration - drives generate-briefing-if-due! with EITHER
;; the REAL compiled emit-cost-health-sidecar.js CLI (mode "real", against a
;; fixture git repo the acceptance step handler builds) or a fake adapter
;; that always throws (mode "fail", proving the best-effort ordering),
;; logging every :notify!/:log! call to a file - no real tmux, no real timer
;; (now-ms is injected by the caller).
;;
;; Usage: briefing_generation_sidecar_test_runner.bb <fixture-root> <now-ms> <morning-hour> <morning-minute> <emit-mode: real|fail>

(ns briefing-generation-sidecar-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_generation_schedule_lib.bb")))

(def fixture-root (nth *command-line-args* 0))
(def now-ms (parse-long (nth *command-line-args* 1)))
(def morning-hour (parse-long (nth *command-line-args* 2)))
(def morning-minute (parse-long (nth *command-line-args* 3)))
(def emit-mode (nth *command-line-args* 4))

(def briefings-dir (str (fs/path fixture-root "docs" "briefings")))
(def calls-log (str (fs/path fixture-root "calls.log")))
(def repo-root (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." "..")))
(def cli-path (str (fs/path repo-root "extension" "out" "tools" "emit-cost-health-sidecar.js")))

(defn log-call! [& parts]
  (spit calls-log (str (str/join " " parts) "\n") :append true))

(def emit-sidecar!
  (case emit-mode
    "fail" (fn [] (throw (ex-info "simulated emit failure" {})))
    "real" (fn []
             (let [{:keys [exit err]} (process/sh ["node" cli-path] {:dir fixture-root})]
               (log-call! "emit-attempted" (str exit))
               (when-not (zero? exit)
                 (throw (ex-info "emit CLI failed" {:exit exit :err err})))))))

(def fired?
  (briefing-generation-schedule-lib/generate-briefing-if-due!
   now-ms morning-hour morning-minute briefings-dir
   {:emit-sidecar! emit-sidecar!
    :notify! (fn [text] (log-call! "notify" text))
    :log! (fn [& parts] (apply log-call! parts))}))

(println (str "FIRED=" fired?))
