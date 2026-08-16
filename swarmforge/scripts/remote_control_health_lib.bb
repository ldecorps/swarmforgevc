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

;; ── BL-898: session-dead detection (flag present, cloud session gone) ──────
;; classify (above) trusts argv alone, by design (see file header) - it
;; cannot see that the websocket behind a correct flag has died. The pane
;; footer can: Claude Code prints a bare "/rc" when its remote-control
;; session is live and "/rc failed" when it drops. One observation is never
;; enough (a mid-reconnect blip must not trigger anything), so this status
;; only fires once footer-status has read :failed on 2+ CONSECUTIVE sweeps -
;; see advance-footer-streak! for how that consecutiveness is persisted
;; across the separate `./swarm ensure` process invocations that observe it.

(def ^:private session-dead-footer-streak-threshold 2)

(defn footer-status
  "Reads ONLY the footer/status-line region of a pane capture - the LAST
   non-blank captured line - never the whole scrollback. Reading the whole
   capture would match a stale `/rc failed` merely echoed higher up from an
   earlier redraw rather than the currently-rendered chrome. Returns :failed,
   :healthy, or :unknown (no recognizable RC chrome on that line at all -
   e.g. remote_control is off for this role, or the capture landed mid-
   redraw); :unknown deliberately carries no opinion either way."
  [pane-capture-text]
  (let [lines (remove str/blank? (str/split-lines (or pane-capture-text "")))
        footer (last lines)]
    (cond
      (nil? footer) :unknown
      (re-find #"/rc failed" footer) :failed
      (re-find #"(^|\s)/rc(\s|$)" footer) :healthy
      :else :unknown)))

(defn footer-streak-path [state-dir role]
  (fs/path state-dir "rc-footer-streak" (str role)))

(defn read-footer-streak
  "Consecutive-:failed-footer-observations counter persisted for role, 0 if
   never observed. A separate `./swarm ensure` process runs each sweep, so
   this file - not in-process state - is what makes consecutiveness durable
   across invocations."
  [state-dir role]
  (let [f (footer-streak-path state-dir role)]
    (if (fs/exists? f)
      (or (parse-long (str/trim (slurp (str f)))) 0)
      0)))

(defn write-footer-streak! [state-dir role n]
  (let [f (footer-streak-path state-dir role)]
    (fs/create-dirs (fs/parent f))
    (spit (str f) (str (long n) "\n"))))

(defn advance-footer-streak!
  "Persists and returns the new streak for THIS observation: increments on
   :failed, resets to 0 on :healthy. :unknown neither manufactures nor erases
   a real streak (a mid-redraw capture must not silently reset progress
   toward - or falsely complete - the consecutive-observation requirement),
   so it passes the existing streak through unchanged. Call exactly ONCE per
   real sweep tick - calling it twice in one tick (e.g. once for a before-
   repair check and again for an after-repair re-check) would double-count
   a single observation."
  [state-dir role footer-stat]
  (case footer-stat
    :failed (let [n (inc (read-footer-streak state-dir role))]
              (write-footer-streak! state-dir role n)
              n)
    :healthy (do (write-footer-streak! state-dir role 0) 0)
    :unknown (read-footer-streak state-dir role)))

(defn classify-session
  "classify (above), extended with the one case it cannot see on its own:
   when the flag matches (classify would say :healthy) but the footer has
   persistently (footer-streak >= 2) reported the session dead, that is
   :session-dead, not :healthy. Never changes :off/:down/:degraded - BL-898
   must leave :degraded (BL-514's case: a live agent that LOST its flag)
   byte-for-byte alone; this only ever reclassifies what classify already
   called :healthy."
  [expected actual alive? footer-streak]
  (let [base (classify expected actual alive?)]
    (if (and (= base :healthy)
             (>= (long (or footer-streak 0)) session-dead-footer-streak-threshold))
      :session-dead
      base)))

(defn check-role
  "Full RC status for one role: {:role :status :expected :actual}. The
   `cmdline-fn` (socket session -> claude argv string or nil) is injectable so
   swarm_ensure and the tests can supply a probe without a real agent process.
   The 6-arg arity additionally threads a pre-advanced `footer-streak`
   (advance-footer-streak!, called ONCE per sweep by the caller) through
   classify-session instead of classify, so a role can come back :session-dead
   - callers that never pass footer-streak (BL-514's original 4/5-arg calls,
   remote_control_health.bb's standalone --fix CLI) are entirely unaffected
   and can never produce that status, unchanged from before BL-898."
  ([state-dir socket role session]
   (check-role state-dir socket role session claude-cmdline-in-pane))
  ([state-dir socket role session cmdline-fn]
   (let [expected (expected-rc-name state-dir role)
         cmdline  (when socket (cmdline-fn socket session))
         actual   (extract-rc-name cmdline)]
     {:role role
      :status (classify expected actual (some? cmdline))
      :expected expected
      :actual actual}))
  ([state-dir socket role session cmdline-fn footer-streak]
   (let [expected (expected-rc-name state-dir role)
         cmdline  (when socket (cmdline-fn socket session))
         actual   (extract-rc-name cmdline)]
     {:role role
      :status (classify-session expected actual (some? cmdline) footer-streak)
      :expected expected
      :actual actual})))

(defn actionable?
  "RC is worth repairing when a live agent lost its flag (:degraded) or when
   its flag is fine but its cloud session has died (:session-dead, BL-898).
   :down is the pane-liveness check's job; :off and :healthy need nothing.
   swarm_ensure uses this so the RC check never double-respawns a crashed pane,
   and every existing caller of this ONE predicate picks up :session-dead
   automatically instead of growing a second, parallel repair-worthy check."
  [status]
  (contains? #{:degraded :session-dead} status))

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

;; ── BL-898: idle-safe wait/confirm, shared by every :session-dead repair ───
;; wait-until-idle! and confirm-rc! ARE remote_control_respawn.bb's own wait/
;; confirm loops (invariant 1: a session-dead respawn only ever happens while
;; the agent is idle, exactly like a :degraded respawn already is over there)
;; - lifted here so swarm_ensure.bb's :session-dead repair drives the SAME
;; idle-safe machinery instead of a second, hand-rolled wait loop.
;; remote_control_respawn.bb itself is untouched: it keeps its own inline
;; loops (out of scope for this ticket), these are net-new call sites.

(defn wait-until-idle!
  "Polls (busy?-fn) up to wait-seconds, sleeping between polls, driven by the
   pure wait-outcome decision above. Returns true if the target went idle
   within budget, false on timeout - never kills or interrupts anything
   itself, it only ever decides when it is SAFE for the caller to respawn.
   sleep-fn (ms -> ignored) is injectable so tests drive this without a real
   wall clock."
  ([busy?-fn wait-seconds] (wait-until-idle! busy?-fn wait-seconds 3000 #(Thread/sleep %)))
  ([busy?-fn wait-seconds poll-ms sleep-fn]
   (loop [remaining wait-seconds]
     (case (wait-outcome (busy?-fn) remaining)
       :idle true
       :timeout false
       :keep-waiting (do (sleep-fn poll-ms) (recur (- remaining (quot poll-ms 1000))))))))

(defn confirm-rc!
  "After a respawn, polls (cmdline-fn) until the RC flag matches expected,
   then reads the fresh session URL via (capture-fn). {:ok bool :url
   str-or-nil :actual str-or-nil}. url is nil only when confirmation
   succeeded but no URL was present in the new capture yet (session-url-
   in-capture already documents that false negative) - the caller is
   responsible for turning that into an explicit statement, never a
   fabricated address (invariant 2)."
  ([cmdline-fn capture-fn expected] (confirm-rc! cmdline-fn capture-fn expected 20 1500 #(Thread/sleep %)))
  ([cmdline-fn capture-fn expected tries poll-ms sleep-fn]
   (loop [n tries]
     (let [actual (extract-rc-name (cmdline-fn))]
       (cond
         (= actual expected) {:ok true :url (session-url-in-capture (capture-fn)) :actual actual}
         (<= n 0)            {:ok false :url nil :actual actual}
         :else               (do (sleep-fn poll-ms) (recur (dec n))))))))

(defn repair-notice-text
  "Pure text for invariant 2: the human is ALWAYS told the outcome of a
   session-dead repair - the new session address when session-url is
   readable, an explicit statement when it is not. Never returns a
   fabricated address: session-url is either exactly what confirm-rc!
   read from the live pane, or nil."
  [role session-url]
  (if session-url
    (str "swarmforge-" role ": remote control had gone dead (flag present, "
         "cloud session lost) and has been repaired. New session: " session-url)
    (str "swarmforge-" role ": remote control had gone dead and has been "
         "repaired, but the new session address could not be read from the "
         "pane yet - check the pane directly.")))
