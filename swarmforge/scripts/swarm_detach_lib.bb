;; BL-372: pure decision logic for "did the swarm launch actually detach
;; from whoever started it, and what should the launcher report". Loaded
;; via load-file, not required on a classpath:
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
;; DETACHED SIGNAL - REVISED (BL-372 architect bounce, 2026-07-14). The
;; first cut of this file used "the launched process's current parent pid
;; no longer equals the caller's pid" as the detached signal, checked
;; against the tmux SERVER's own pid. The architect reproduced, twice,
;; independently, that this NEVER discriminates against a real tmux
;; server: tmux's server self-daemonizes unconditionally by design (the
;; `new-session` client forks the server and exits almost immediately),
;; so the server's ppid is reparented away from its original caller
;; within a fraction of a second - identically whether or not the launch
;; chain used nohup. A follow-up repro (this file's own author, same day)
;; showed the architect's own suggested alternative - checking the
;; server's SIGHUP-ignored bit - fails the SAME way: tmux's server
;; already ignores SIGHUP internally (for its own, unrelated reason: not
;; dying when an attached CLIENT's terminal hangs up), again identically
;; regardless of the launcher's own nohup. Both signals are permanently
;; masked by tmux's own self-protective behavior - checking the FINAL
;; tmux server process can never prove or disprove the launcher's fix.
;;
;; The signal that DOES discriminate: whether nohup's own direct,
;; immediate effect - setting SIGHUP's disposition to ignored on the
;; process IT wraps - actually took hold on OUR OWN launch job (the
;; backgrounded ./swarm invocation), checked while that job is still
;; alive (right after backgrounding it, not after the fact). This is a
;; fact about our own mechanism, not a claim about tmux's internals, and
;; it flips correctly in both directions: verified in this session,
;; `sleep 30 &` shows SigIgn missing bit 0 (SIGHUP not ignored);
;; `nohup sleep 30 >/dev/null 2>&1 &` shows bit 0 set.

(ns swarm-detach-lib)

(defn sighup-ignored?
  "Does this raw ignored-signals bitmask (as read from a process's
   /proc/<pid>/status SigIgn line on Linux, or the equivalent ps -o
   sigignore= mask on macOS/BSD) include SIGHUP (signal 1, bit 0)? This is
   nohup's own direct, verifiable effect on the process it wraps."
  [sig-ignore-mask]
  (boolean (and sig-ignore-mask (not (zero? (bit-and sig-ignore-mask 1))))))

(defn decide-launch-outcome
  "Given whether the swarm actually came up (ready?) and whether the
   launch job's own detach mechanism genuinely engaged (detached?),
   decide the launch's pass/fail outcome and the message to report. Never
   silently reports success on either failure mode - a launch that is
   ready but never actually detached must fail just as loudly as one that
   never came up at all, or a regression here would be silent again,
   exactly as it was twice on 2026-07-14."
  [{:keys [ready? detached?]}]
  (cond
    (not ready?)
    {:ok? false :message "swarm did not become ready"}

    (not detached?)
    {:ok? false
     :message "swarm launch is still owned by the caller - it will die when the caller exits"}

    :else
    {:ok? true :message "swarm is up and its launch is detached from the caller"}))
