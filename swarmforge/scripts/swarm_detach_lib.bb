;; BL-372: pure decision logic for "did the swarm actually detach from
;; whoever launched it, and what should the launcher report". Loaded via
;; load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "swarm_detach_lib.bb")))
;; and referred to as swarm-detach-lib/foo.
;;
;; INCIDENT: twice on 2026-07-14 a swarm launched from a short-lived caller
;; (a disposable Operator window) came up correctly - 8/8 sessions, panes
;; alive - then died the moment the caller exited, producing an 8x
;; AGENT_EXITED storm minutes later. handoffd from the SAME launch stayed
;; alive and init-parented (start_handoff_daemon.sh's nohup ... & already
;; protects it); the tmux server, which nothing detached, did not. A swarm
;; is a long-lived service - whose shell happened to start it must not
;; decide how long it lives.
;;
;; DETACHED signal: the launched server's current parent pid no longer
;; equals the caller's own pid. Deliberately NOT "ppid == 1" - that reads
;; correctly on a plain host (where a fully orphaned process is reparented
;; to true init), but false-negatives under a container/subreaper (a
;; non-1 pid still reaps it) or under systemd-logind's per-session cgroup
;; teardown. "No longer a child of the specific process that launched it"
;; is the invariant that actually matters and holds in both environments.

(ns swarm-detach-lib)

(defn detached?
  "Has the launched process been re-parented away from the caller that
   launched it? server-ppid is the launched process's CURRENT parent pid;
   caller-pid is the pid of the process that did the launching."
  [{:keys [server-ppid caller-pid]}]
  (boolean (and (some? server-ppid) (some? caller-pid) (not= server-ppid caller-pid))))

(defn decide-launch-outcome
  "Given whether the swarm actually came up (ready?) and whether its tmux
   server is genuinely detached from the caller (detached?), decide the
   launch's pass/fail outcome and the message to report. Never silently
   reports success on either failure mode - a launch that is ready but
   still owned by the caller must fail just as loudly as one that never
   came up at all, or a regression here would be silent again, exactly as
   it was twice on 2026-07-14."
  [{:keys [ready? detached?]}]
  (cond
    (not ready?)
    {:ok? false :message "swarm did not become ready"}

    (not detached?)
    {:ok? false
     :message "swarm came up but its tmux server is still owned by the caller - it will die when the caller exits"}

    :else
    {:ok? true :message "swarm is up and its tmux server is detached from the caller"}))
