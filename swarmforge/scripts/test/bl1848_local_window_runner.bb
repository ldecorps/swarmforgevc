#!/usr/bin/env bb
;; BL-1848: JSON bridge over the REAL local-window gatherer and check - the
;; acceptance handler drives this, never a JS restatement of either.
;;
;; Usage: bb bl1848_local_window_runner.bb <fixture-root> <subcommand> <json>
;;   check {"base_url":"http://127.0.0.1:<port>","usage_dir":"<dir>"}
;;         gather-local-window-facts, then check-local-window-fit
;;   sweep {"base_url":...,"usage_dir":...}
;;         the same facts, carried through assemble-findings as the live
;;         sweep's snapshot carries them
;;
;; <fixture-root> is the handler's tracked temp root: babysitter_check.bb
;; needs a project-root argv at load time, and this runner creates no
;; directory of its own. Prints {"findings":[...],"elapsed_ms":N}.

(ns bl1848-local-window-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def scripts-dir
  (str (fs/parent (fs/parent (fs/canonicalize *file*)))))

(def fixture-root (first *command-line-args*))
(def subcommand (second *command-line-args*))
(def payload (json/parse-string (or (nth *command-line-args* 2 nil) "{}") true))

(binding [*command-line-args* [fixture-root]]
  (load-file (str (fs/path scripts-dir "babysitter_check.bb"))))

(let [now (System/currentTimeMillis)
      started (System/nanoTime)
      facts (babysitter-check/gather-local-window-facts
             {:base-url (:base_url payload) :usage-dir (:usage_dir payload) :now now})
      findings (case subcommand
                 "check" (babysitterd-sweep-lib/check-local-window-fit facts now)
                 "sweep" (:findings (babysitterd-sweep-lib/assemble-findings
                                     {:roles [] :now-ms now :available-mb 999999
                                      :mem-floor-mb 0 :local-windows facts}))
                 (do (binding [*out* *err*] (println "unknown subcommand:" subcommand))
                     (System/exit 2)))]
  (println (json/generate-string
            {:findings findings
             :elapsed_ms (quot (- (System/nanoTime) started) 1000000)})))
