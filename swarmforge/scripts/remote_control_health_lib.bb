#!/usr/bin/env bb

;; Remote-control (RC) health predicate, shared by remote_control_health.bb
;; (the standalone CLI) and swarm_ensure.bb (so `./swarm ensure` verifies RC
;; as part of its BAU "are the agents up and running" sweep).
;;
;; What "RC healthy" means, and why this is the signal we can trust:
;; Claude agents are launched with `--remote-control SwarmForge-<Role>`, which
;; opens a claude.ai/code session and holds a websocket the CLI reconnects on
;; its own. There is NO local file or port that reports that websocket's
;; liveness, so the strongest truthful signal available is: the pane's live
;; `claude` process still carries its `--remote-control <name>` flag. If it
;; does, the CLI owns (and keeps reviving) the connection; if a live agent is
;; running WITHOUT the flag, it was started by a stale/hand-rolled command and
;; will never appear in claude.ai/code until respawned from its launch script.
;;
;; The scrollback-scraping in list_remote_control_sessions.sh is deliberately
;; NOT used here: the startup banner (with the session URL) scrolls out of the
;; capture window on any long-lived agent, so "no URL in pane" is a false
;; negative, not a dead connection. This predicate reads process argv instead.
;;
;; Statuses:
;;   :off       launch script has no --remote-control (config remote_control off)
;;   :down      no live claude process in the pane (pane-liveness' job to repair)
;;   :healthy   live claude process carries the expected --remote-control name
;;   :degraded  live claude process is missing/has the wrong RC name -> respawn

(ns remote-control-health
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def ^:private nul (str (char 0)))

(defn extract-rc-name
  "The value following --remote-control in a command string, or nil. Accepts
   both `--remote-control X` and `--remote-control=X` forms."
  [cmd]
  (when cmd
    (some-> (re-find #"--remote-control[= ]([A-Za-z0-9._-]+)" cmd) second)))

(defn launch-script-path
  "Where a role's persisted launch script lives - the single source of truth
   both the health check (to read the expected RC name) and the respawn CLIs
   (to actually respawn the pane) resolve against, so the two never drift."
  [state-dir role]
  (fs/path state-dir "launch" (str role ".sh")))

(defn expected-rc-name
  "The RC name a role SHOULD run with, read from its persisted launch script
   (the source of truth for how its pane is respawned). nil when the script is
   absent or carries no --remote-control (RC deliberately off for that role)."
  [state-dir role]
  (let [launch (launch-script-path state-dir role)]
    (when (fs/exists? launch)
      (extract-rc-name (slurp (str launch))))))

(defn respawn-role-pane!
  "Kills and respawns session on socket running its persisted launch script,
   which restores whatever --remote-control flag that script carries. Shared
   by remote_control_health.bb's --fix repair and remote_control_respawn.bb's
   graceful respawn so the exact tmux invocation exists in one place."
  [socket session launch-path]
  (process/sh {:continue true} "tmux" "-S" socket "respawn-pane" "-k"
              "-t" session (str "zsh '" launch-path "'")))

(defn descendant-pids
  "pane-pid plus every transitive child pid. The pane process is the role's
   shell (zsh); the claude process is a descendant, so we must walk the tree."
  [pane-pid]
  (loop [frontier [pane-pid] seen []]
    (if-let [pid (first frontier)]
      (let [children (->> (process/sh {:continue true} "pgrep" "-P" (str pid))
                          :out str/split-lines (remove str/blank?)
                          (map str/trim))]
        (recur (concat (rest frontier) children) (conj seen pid)))
      seen)))

(defn- proc-cmdline
  "The argv of pid as a space-joined string, or nil if it's gone.
   /proc/<pid>/cmdline is NUL-separated."
  [pid]
  (let [f (str "/proc/" pid "/cmdline")]
    (when (fs/exists? f)
      (-> (slurp f) (str/replace nul " ") str/trim))))

(defn claude-cmdline-in-pane
  "argv of the live claude agent process inside the pane, or nil if none is
   running. A claude agent is identified by the flags every launch script gives
   it (--append-system-prompt-file plus --dangerously-skip-permissions) so we
   don't mistake an unrelated child (a `bb`, a `git`) for the agent."
  [socket session]
  (let [pane-pid (-> (process/sh {:continue true} "tmux" "-S" socket
                                 "list-panes" "-t" session "-F" "#{pane_pid}")
                    :out str/split-lines first (some-> str/trim))]
    (when (and pane-pid (not (str/blank? pane-pid)))
      (->> (descendant-pids pane-pid)
           (keep proc-cmdline)
           (filter #(and (str/includes? % "--append-system-prompt")
                         (str/includes? % "--dangerously-skip-permissions")))
           first))))

(defn classify
  "Pure decision. `expected` is the name the launch script wants (nil = RC off);
   `actual` is the RC name on the live claude process (nil = flag absent);
   `alive?` is whether a claude process is running in the pane at all. The last
   arg is what separates :down (no process - the pane check's job) from
   :degraded (a live agent that lost its flag - the case RC repair owns)."
  [expected actual alive?]
  (cond
    (nil? expected)     :off
    (not alive?)        :down
    (= expected actual) :healthy
    :else               :degraded))

(defn check-role
  "Full RC status for one role: {:role :status :expected :actual}. The
   `cmdline-fn` (socket session -> claude argv string or nil) is injectable so
   swarm_ensure and the tests can supply a probe without a real agent process."
  ([state-dir socket role session]
   (check-role state-dir socket role session claude-cmdline-in-pane))
  ([state-dir socket role session cmdline-fn]
   (let [expected (expected-rc-name state-dir role)
         cmdline  (when socket (cmdline-fn socket session))
         actual   (extract-rc-name cmdline)]
     {:role role
      :status (classify expected actual (some? cmdline))
      :expected expected
      :actual actual})))

(defn actionable?
  "RC is worth repairing only when a live agent lost its flag (:degraded).
   :down is the pane-liveness check's job; :off and :healthy need nothing.
   swarm_ensure uses this so the RC check never double-respawns a crashed pane."
  [status]
  (= :degraded status))

(defn session-url-in-capture
  "The most recent claude.ai/code session URL printed in pane-capture-text (a
   multi-line tmux capture-pane dump), or nil if none is present. Every
   respawn reprints the URL in its startup banner, so `last` picks the
   freshest one even when older banners are still in scrollback."
  [pane-capture-text]
  (->> (str/split-lines (or pane-capture-text ""))
       (keep #(second (re-find #"(https://claude\.ai/code/session_[A-Za-z0-9_-]+)" %)))
       last))

(defn wait-outcome
  "Pure decision for one tick of a busy-wait poll loop: given whether the
   target is busy RIGHT NOW and how many seconds remain in the wait budget,
   decide whether to stop (idle/timeout) or keep polling. Separated from
   remote_control_respawn.bb's actual loop so the decision is testable
   without a real clock or a live tmux pane - the loop itself is just this
   function driving Thread/sleep, which is the untestable boundary."
  [busy-now? remaining-seconds]
  (cond
    (not busy-now?)          :idle
    (<= remaining-seconds 0) :timeout
    :else                    :keep-waiting))
