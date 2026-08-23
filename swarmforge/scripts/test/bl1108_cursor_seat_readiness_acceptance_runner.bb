#!/usr/bin/env bb
;; BL-1108: JSON bridge over the REAL babysitter marker + sweep decision
;; functions that the Cursor seat-readiness hotfix landed. Never a JS
;; restatement of agent-process-marker / check-live-session /
;; check-remote-control.
;;
;; Usage: bb bl1108_cursor_seat_readiness_acceptance_runner.bb <subcommand> <json>
;;   live-seat-health  {"agent":"cursor"|"claude", "process":"<argv fragment>"}
;;   markers           {}
;;
;; live-seat-health fabricates a ps snapshot whose child argv is the given
;; process fragment (Claude seats also carry --remote-control so a healthy
;; Claude RC check is reachable — Cursor seats never do). Then it drives the
;; same check-live-session / check-remote-control the live sweep uses.

(ns bl1108-cursor-seat-readiness-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir
  (str (fs/parent (fs/parent (fs/canonicalize *file*)))))

(binding [*command-line-args* [(str (fs/create-temp-dir {:prefix "bl1108-bb-root-"}))]]
  (load-file (str (fs/path scripts-dir "babysitter_check.bb"))))

(def subcommand (first *command-line-args*))
(def payload (json/parse-string (or (second *command-line-args*) "{}") true))

(defn- process-argv [agent process-fragment]
  (let [base (str process-fragment)]
    (if (= agent "claude")
      (str base " --remote-control")
      base)))

(defn- classify-rc [role-map]
  (let [finding (babysitterd-sweep-lib/check-remote-control role-map)]
    (cond
      (not (:rc-applicable? role-map)) "off"
      (nil? finding) "healthy"
      :else "degraded")))

(defn- live-seat-health [{:keys [agent process]}]
  (let [agent (or agent "claude")
        marker (babysitter-check/agent-process-marker agent)
        pane-pid "4242"
        argv (process-argv agent process)
        ps (str " 9999  " pane-pid " " argv "\n")
        line (babysitter-check/agent-process-line pane-pid ps agent)
        has-agent? (boolean line)
        rc-applicable? (= agent "claude")
        has-rc? (boolean (and rc-applicable? line (str/includes? (str line) "--remote-control")))
        role-map {:role "coder"
                  :pane-exists? true
                  :has-claude-process? has-agent?
                  :expected-agent agent
                  :expected-process marker
                  :process-gather-failed? false
                  :rc-applicable? rc-applicable?
                  :has-remote-control? has-rc?}
        proc-finding (babysitterd-sweep-lib/check-live-session role-map)]
    {:agent agent
     :marker marker
     :matchedLine (boolean line)
     :processResult (if has-agent? "present" "absent")
     :remoteControlResult (classify-rc role-map)
     :processFindingKey (some-> proc-finding :key)
     :processFindingSeverity (some-> proc-finding :severity)
     :rcApplicable rc-applicable?}))

(defn- markers []
  {:markers (into {} (map (fn [[k v]] [k v]) babysitter-check/agent-process-markers))
   :cursor (babysitter-check/agent-process-marker "cursor")
   :claude (babysitter-check/agent-process-marker "claude")
   :unknown (babysitter-check/agent-process-marker "weirdagent")})

(def result
  (case subcommand
    "live-seat-health" (live-seat-health payload)
    "markers" (markers)
    (do (binding [*out* *err*]
          (println "Usage: bl1108_cursor_seat_readiness_acceptance_runner.bb <live-seat-health|markers> <json>"))
        (System/exit 2))))

(println (json/generate-string result))
