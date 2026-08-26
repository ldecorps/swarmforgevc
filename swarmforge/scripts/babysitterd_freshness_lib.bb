#!/usr/bin/env bb
;; Pure decision core for babysitterd liveness + Operator tell-don't-restart.
;;
;; Process table is a shared global: callers inject a process snapshot
;; ({:pid :cmdline} rows). This lib never shells out, never reads a pidfile,
;; never starts or kills anything. start_babysitterd.sh has a POSIX twin of
;; daemon-cmdline? and MUST stay aligned (commented there).
;;
;; Operator polls this every full tick and tells (coordinator note + status)
;; — it never calls start_babysitterd.sh. Cron (BL-675) remains the restarter.
;; start_babysitterd.sh / ./swarm ensure adopt a live orphan by rewriting the
;; pidfile.

(ns babysitterd-freshness-lib
  (:require [clojure.string :as str]))

(def daemon-name-re
  "Matches the daemon script as its own argv token, never start_babysitterd.sh
   (that name's suffix is the same bytes)."
  #"(?:^|[\s/])babysitterd\.sh(?:\s|$)")

(defn daemon-cmdline?
  "True when cmdline is THIS root's looping babysitterd daemon.
   False for start_babysitterd.sh, --tick-once, other roots, or empty input."
  [cmdline project-root]
  (let [cmd (str cmdline)
        root (str project-root)]
    (boolean
     (and (not (str/blank? cmd))
          (not (str/blank? root))
          (str/includes? cmd root)
          (re-find daemon-name-re cmd)
          (not (str/includes? cmd "start_babysitterd.sh"))
          (not (str/includes? cmd "--tick-once"))))))

(defn find-live-pid
  "First pid in `processes` whose cmdline is this root's babysitterd daemon,
   or nil. `processes` is [{:pid Long :cmdline String}]."
  [project-root processes]
  (some (fn [{:keys [pid cmdline]}]
          (when (and pid (daemon-cmdline? cmdline project-root))
            pid))
        processes))

(defn resolve-live-pid
  "Pidfile wins when it is alive; otherwise the process-table orphan, if any."
  [pidfile-pid pidfile-alive? orphan-pid]
  (cond
    (and pidfile-pid pidfile-alive?) pidfile-pid
    orphan-pid orphan-pid
    :else nil))

(defn classify
  "Snapshots in, a state out. :action is only :tell or :none — never :restart.
   Priority: skip > no process > pidfile lie > announce mute > healthy."
  [{:keys [enabled? live-pid pidfile-alive? telegram-creds?]}]
  (cond
    (not enabled?)
    {:state "disabled" :action :none :finding nil}

    (nil? live-pid)
    {:state "down"
     :action :tell
     :finding (str "babysitterd process is not running for this root "
                   "(a missing pidfile is not proof either way). "
                   "Cron freshness or ./swarm ensure should restart it. "
                   "Operator will not spawn a second copy.")}

    (not pidfile-alive?)
    {:state "pidfile-lie"
     :action :tell
     :finding (str "babysitterd pid=" live-pid
                   " is alive but the pidfile is missing or stale — "
                   "./swarm status was lying. ./swarm ensure / "
                   "start_babysitterd.sh will adopt that pid (rewrite the "
                   "pidfile), never start a duplicate.")}

    (not telegram-creds?)
    {:state "announce-mute"
     :action :tell
     :finding (str "freshness checker cannot announce "
                   "(TELEGRAM_BOT_TOKEN/CHAT_ID missing from env files and "
                   "~/.swarmforge/fleet/<swarm>/telegram.json). Restarts "
                   "still happen; humans are not told.")}

    :else
    {:state "healthy" :action :none :finding nil}))

(defn should-alert?
  "Cooldown gate for :tell. A first finding always fires (nil last-alert)."
  [classified last-alert-at-ms now-ms cooldown-ms]
  (boolean
   (and (= :tell (:action classified))
        (or (nil? last-alert-at-ms)
            (>= (- (long now-ms) (long last-alert-at-ms))
                 (long cooldown-ms))))))

(defn should-unlink-pidfile?
  "Pure twin of babysitterd.sh's own EXIT trap (BL-906 invariant 2): a
   pidfile is unlinked only when its recorded content, whitespace-trimmed,
   equals this process's own pid, as strings. Bash original MUST stay
   aligned (commented there) - this is the decision the trap encodes, not a
   reimplementation of the trap itself (which also does the actual rm -f)."
  [recorded-pidfile-content own-pid]
  (= (str/trim (or recorded-pidfile-content ""))
     (str own-pid)))
