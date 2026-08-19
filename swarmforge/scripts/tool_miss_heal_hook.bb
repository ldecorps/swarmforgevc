#!/usr/bin/env bb
;; BL-913 (epic tool-miss-auto-heal, slice A): the PreToolUse hook entry
;; point - the thin, untested I/O boundary around tool_miss_heal_lib.bb's
;; pure build-healing-wrapper-command. Reads Claude Code's own PreToolUse
;; hook JSON from stdin, and - for a Bash tool call, when the role's own
;; pinned worktree is known - rewrites tool_input.command into the
;; self-healing wrapper via hookSpecificOutput.updatedInput.command. Every
;; other case (a non-Bash tool, or the pin unknown) prints an empty {} and
;; changes nothing: this hook fails OPEN to "do not touch the command",
;; never to "block the tool call" - a bug here must never stop a role from
;; running commands at all, only (at worst) leave the pre-BL-913 unhealed
;; behaviour in place.
;;
;; Invariant 2 ("the pinned environment is derived from the role's own
;; worktree, never from the cwd the process happened to inherit"): the pin
;; comes from SWARMFORGE_ROLE_WORKTREE, an env var exported by the launch
;; script itself (write_role_launch_script in swarmforge.sh) from the SAME
;; WORKTREE_PATHS array that generates the role's own `cd` line - the swarm's
;; own record of where the role lives, never this hook's own $PWD (which is
;; whatever the LIVE session's persistent shell cwd happens to be at the
;; moment this particular tool call fires - exactly the value invariant 2
;; forbids using).
(ns tool-miss-heal-hook
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "tool_miss_heal_lib.bb")))

(defn- pass-through! []
  (println "{}")
  (System/exit 0))

(defn -main [& _args]
  (let [raw (slurp *in*)
        payload (try (json/parse-string raw true) (catch Exception _ nil))]
    (when (or (nil? payload) (not= (:tool_name payload) "Bash"))
      (pass-through!))
    (let [command (get-in payload [:tool_input :command])
          pinned-worktree (System/getenv "SWARMFORGE_ROLE_WORKTREE")]
      (when (or (nil? command) (str/blank? pinned-worktree))
        (pass-through!))
      (let [wrapper (tool-miss-heal-lib/build-healing-wrapper-command command pinned-worktree)]
        (println (json/generate-string
                  {:hookSpecificOutput
                   {:hookEventName "PreToolUse"
                    :updatedInput {:command wrapper}}}))))))

(apply -main *command-line-args*)
