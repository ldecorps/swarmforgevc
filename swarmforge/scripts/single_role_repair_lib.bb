;; single_role_repair_lib.bb — BL-1018. The ONE definition of what a
;; single-role repair may resolve to.
;;
;; THE INCIDENT. 2026-08-21 ~08:26 UTC: the operator health sweep found
;; swarmforge-specifier genuinely gone and attempted a single-role respawn -
;; create the session, then respawn-pane the launch script into it. The ENTIRE
;; pack tmux server died: socket 3752320954, handoffd with it, eight sessions
;; gone, recovery needed a full ./start-swarm.sh. No audit trail survived the
;; teardown, so the root mechanism is UNPROVEN and this lib does not pretend
;; otherwise. BL-958 named the leading hypothesis - a respawn issued against a
;; MISSING session can restart a half-alive tmux server - which is why a
;; missing session here is CREATED WITH its command and never respawned into.
;;
;; The value does not rest on that hypothesis. Constraining the resolution
;; surface removes the whole family of ways a one-role repair can reach the
;; server, whichever member of it actually fired.
;;
;; Pure by design: it returns commands, it never runs them. That is what makes
;; the dangerous property ("no resolved command can reach beyond this role's
;; own session") assertable at all - live tmux teardown is not something a
;; test can safely provoke.
;;
;; Load:
;;   (load-file ... "single_role_repair_lib.bb")
;;   single-role-repair-lib/resolve-single-role-repair opts

(ns single-role-repair-lib
  (:require [clojure.string :as str]))

(defn- blank? [v] (str/blank? (str v)))

;; Every command starts here. Nothing in this lib builds a tmux invocation any
;; other way, so "names the pack socket explicitly" is a property of the one
;; constructor rather than a rule each call site has to remember - a rule
;; remembered per call site is exactly how one command ends up inheriting the
;; default socket and reaching a server nobody intended to touch.
(defn- tmux-cmd [socket & args]
  (into ["tmux" "-S" (str socket)] args))

(defn resolve-single-role-repair
  "Pure: the command set a single-role repair may run, given what is known
   about that role's session RIGHT NOW.

   Returns {:status :ok :commands [[...] ...]} or a refusal
   ({:status :no-socket | :no-session-name | :no-launch-script, :commands []}).

   Branches on observed session state, and the two branches are deliberately
   NOT the same command with a flag flipped:

     missing -> ONE new-session that carries the env args and the launch
                command itself. Never a bare create followed by a respawn into
                it: that sequence is the incident's own shape.
     present -> ONE respawn-pane -k against that session, in place. Never a
                create for a session that already exists.

   A refusal resolves to NO commands at all - never a best-effort command with
   a hole in it. An untargeted or default-socket command is the failure mode
   this lib exists to remove, so a missing input must never produce one."
  [{:keys [socket session launch-script env-args session-present?]}]
  (cond
    (blank? socket) {:status :no-socket :commands []}
    (blank? session) {:status :no-session-name :commands []}
    (blank? launch-script) {:status :no-launch-script :commands []}
    :else
    (let [launch (str "zsh '" launch-script "'")
          env (vec env-args)]
      {:status :ok
       :commands
       [(if session-present?
          (apply tmux-cmd socket (concat ["respawn-pane" "-k"] env ["-t" (str session) launch]))
          (apply tmux-cmd socket (concat ["new-session" "-d" "-s" (str session) "-n" "swarm"] env [launch])))]})))
