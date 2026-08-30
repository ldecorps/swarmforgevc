#!/usr/bin/env bb
;; BL-993: shared decision logic for the always-on operator-runtime watch.
;; operator_runtime.bb has no supervisor - a crash leaves a stale pidfile and
;; the only repair path (swarm_ensure.bb's operator-healthy?/ensure-operator!)
;; runs only when a human types `./swarm ensure`. This lib holds the pieces
;; that must not diverge between that manual path and the new always-on
;; watch: what "alive" means for this one process, and what "deliberately
;; stopped" means.
;;
;; swarm_ensure.bb cannot be load-file'd for this (its own unconditional
;; (-main) at the bottom would run a full ensure pass and System/exit) - the
;; same reason provider_respawn_env_lib.bb was extracted (see swarm_ensure.bb's
;; own provider-respawn-env-args docstring). This lib is the operator-runtime
;; analog: the ONE place the liveness/stop decision lives, load-file'd by
;; operator_runtime_supervisor.bb, swarm_ensure.bb, swarm_status.bb, and this
;; ticket's own test/acceptance runners.
;;
;; BL-993 architect bounce (backlog/evidence/BL-993-bounce-20260820.md): the
;; first version of this ticket left swarm_ensure.bb's own operator-healthy?
;; and swarm_status.bb's own operator-runtime row on a bare pid-alive? check,
;; reasoning that strengthening them was outside this ticket's scope. That
;; makes THIS lib's healthy? a SECOND, stricter liveness check that can
;; disagree with `./swarm status`/`./swarm ensure` in exactly the pid-reuse
;; case the ticket's own required scenario needs correct - a firm constraint
;; violation. Both call sites now delegate here instead (swarm_ensure.bb:282,
;; swarm_status.bb's operator-runtime row) - this IS the one true check, not
;; a parallel one.
;;
;; A pidfile is not proof of identity: a pidfile naming a LIVE but UNRELATED
;; process (pid reuse after the real runtime died) must read as DOWN, not
;; healthy - a bare `kill -0` cannot tell the two apart. healthy? below
;; additionally checks the process's own command line names
;; operator_runtime.bb.

(ns operator-runtime-watch-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "process_table_lib.bb")))

(defn state-dir [project-root] (fs/path project-root ".swarmforge"))
(defn operator-dir [project-root] (fs/path (state-dir project-root) "operator"))
(defn pid-file [project-root] (fs/path (operator-dir project-root) "runtime.pid"))

;; No equivalent park flag existed for operator-runtime before this ticket
;; (front-desk's own is `.swarmforge/operator/front-desk-PARKED.md`, guarded
;; in launch_front_desk.sh/unpark_front_desk.sh) - this mirrors that shape.
;; A human toggles it directly (touch/rm); QA's own e2e procedure does the
;; same.
(defn park-file [project-root] (fs/path (operator-dir project-root) "operator-runtime-PARKED.md"))

(defn read-pid
  "The pid named by runtime.pid, or nil when absent/unreadable/blank -
   covers BOTH 'no pidfile at all' down-states in one read."
  [project-root]
  (let [f (pid-file project-root)]
    (when (fs/exists? f)
      (try (parse-long (str/trim (slurp (str f)))) (catch Exception _ nil)))))

(defn pid-alive-os?
  "Bare OS-level liveness - true for ANY live process with this pid,
   including one that has nothing to do with operator_runtime.bb (pid
   reuse). Never treat this alone as health; see runtime-alive? below."
  [pid]
  (boolean (when pid (some-> (java.lang.ProcessHandle/of (long pid)) (.orElse nil) (.isAlive)))))

(defn operator-runtime-cmdline?
  "Pure: true when a process's command line looks like our own
   operator_runtime.bb (started via `bb operator_runtime.bb <root>`,
   start_operator_runtime.sh's own invocation shape). No project-root
   scoping here - the pid already came from THIS project's own pidfile, so
   an unrelated project's operator_runtime.bb is not a concern this
   predicate needs to rule out."
  [cmdline]
  (boolean (and cmdline (str/includes? cmdline "operator_runtime.bb"))))

(defn runtime-alive?
  "Pure composition of the two facts above: alive at the OS level AND
   actually our process. A dead pid, a missing pid, and a live-but-unrelated
   pid (pid reuse) all resolve to false here - the one predicate the watch
   and any caller share, so a naive kill-0 check never sneaks back in."
  [pid-alive-os cmdline]
  (boolean (and pid-alive-os (operator-runtime-cmdline? cmdline))))

(defn pid-alive?
  "Same runtime-alive? composition as healthy? below, but for an EXPLICIT
   pid rather than re-reading the pidfile - the shape check-one! itself
   needs for its tracked :pid entry (front_desk_supervisor_lib.bb's
   pid-alive? param)."
  [pid]
  (runtime-alive? (pid-alive-os? pid) (when pid (process-table-lib/cmdline! pid))))

(defn healthy?
  "The one true operator-runtime liveness check (BL-993, strengthened after
   the architect bounce to be THE shared check, not a second one): reads
   the pidfile, checks OS liveness, and - unlike a bare kill-0 - verifies
   the live process's own command line before calling it healthy. Called
   from the always-on watch, swarm_ensure.bb's operator-healthy?, and
   swarm_status.bb's operator-runtime row alike."
  [project-root]
  (pid-alive? (read-pid project-root)))

(defn skip-env-set?
  "SWARMFORGE_SKIP_OPERATOR=1 - the same flag start_operator_runtime.sh and
   swarm_ensure.bb's operator-enabled? already honor."
  []
  (= "1" (System/getenv "SWARMFORGE_SKIP_OPERATOR")))

(defn parked?
  [project-root]
  (fs/exists? (park-file project-root)))

(defn deliberately-stopped?
  "Pure: true when EITHER signal says 'leave it down'. Two args, not two
   I/O reads inside - the observation (skip-env-set?/parked? above) and the
   decision stay separated the same way evaluate-health/check-one! keep
   their own I/O and decision apart elsewhere in this codebase."
  [skip-env parked]
  (boolean (or skip-env parked)))

(defn stop-reason
  "Human-readable reason for a deliberate-stop report - never guesses which
   signal fired when both are set; names every signal that is actually in
   effect."
  [skip-env parked]
  (str/join ", " (remove nil?
                         [(when skip-env "SWARMFORGE_SKIP_OPERATOR=1")
                          (when parked "park flag present")])))

(defn announced-event?
  "Pure: which check-one! events reach the human channel (BL-993 invariant
   2). :started and :re-armed are both 'a restart happened'; :gave-up is
   the escalation. THE single source of truth for 'is this event
   announced' - announcement-for-event below (and through it the real
   supervisor dispatch) gates on this predicate rather than keeping its
   own copy of the set (2026-08-21 architect bounce: the supervisor's
   case dispatch was an independent hand-written copy, and nothing kept
   the two in sync)."
  [event]
  (boolean (#{:started :re-armed :gave-up} event)))

(defn announcement-for-event
  "Pure: the human-channel text for an event, or nil when the event is not
   announced. The ONE composition of 'is it announced' (announced-event?
   above) with 'what does it say', called by the real supervisor's
   announce-for-event! and this ticket's own test/property runners alike -
   so the dispatch can never silently disagree with the predicate. The
   default arm keeps the fail-safe direction invariant 2 demands: an event
   newly added to announced-event? with no bespoke text here still
   produces a real announcement rather than silence."
  [event entry]
  (when (announced-event? event)
    (case event
      :started (if (:pid entry)
                 (str "operator runtime restarted (pid " (:pid entry) ", attempt " (:attempts entry) ")")
                 (str "operator runtime restart attempt " (:attempts entry) " failed to claim a pid"))
      :re-armed (str "operator runtime restarted after cooldown (pid " (:pid entry) ")")
      :gave-up (str "operator runtime restart attempts exhausted after " (:attempts entry)
                    " tries; will retry after cooldown")
      (str "operator runtime watch event " (name event)))))

(defn decide
  "The FULL per-tick decision (BL-993 invariant 1): the deliberate-stop gate
   first, then - only when NOT stopped - check-one!'s own bounded-restart
   state machine. check-one-fn is injected
   (front-desk-supervisor-lib/check-one! in production) so this stays
   load-order-independent and pure; spawn! is only ever reached through it,
   so a deliberate stop provably never restarts anything - not merely by
   convention at each call site, but because THIS function never calls
   check-one-fn at all on that branch."
  [{:keys [skip-env parked entry now-ms pid-alive? spawn! restart-config giveup-config check-one-fn]}]
  (if (deliberately-stopped? skip-env parked)
    {:entry entry :event :deliberately-stopped :stop-reason (stop-reason skip-env parked)}
    (let [{:keys [entry event]} (check-one-fn entry now-ms pid-alive? spawn! restart-config giveup-config)]
      {:entry entry :event event :stop-reason nil})))

(defn initial-entry
  "check-one!'s own default-entry ('not-started') always spawns
   unconditionally on its first check - correct when the runtime is
   genuinely down at supervisor boot, wrong when it is already healthy
   (an already-running operator-runtime must never be restarted just
   because the watch itself just started, per scenario 02). Given an
   already-probed health/pid/clock reading, seeds the state machine so the
   FIRST check! only spawns when the runtime is actually down.
   default-entry-fn is injected (front-desk-supervisor-lib/default-entry in
   production) so this stays load-order-independent and pure."
  [healthy pid now-ms default-entry-fn]
  (if healthy
    {:pid pid :attempts 0 :status "running" :crashed-at-ms nil
     :started-at-ms now-ms :gave-up-at-ms nil}
    (default-entry-fn)))
