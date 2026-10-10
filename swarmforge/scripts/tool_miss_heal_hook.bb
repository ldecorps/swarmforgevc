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

;; Hotfix 2026-10-10: qwen local seats name the shell tool
;; run_shell_command (Claude names it Bash). Same tool_input.command shape;
;; accept both so write_local_model_qwen_settings can register this heal.
(def ^:private shell-tool-names #{"Bash" "run_shell_command"})

(defn -main [& _args]
  (let [raw (slurp *in*)
        payload (try (json/parse-string raw true) (catch Exception _ nil))]
    (when (or (nil? payload) (not (contains? shell-tool-names (:tool_name payload))))
      (pass-through!))
    (let [tool-input (or (:tool_input payload) {})
          command (:command tool-input)
          pinned-worktree (System/getenv "SWARMFORGE_ROLE_WORKTREE")]
      (when (or (nil? command) (str/blank? pinned-worktree))
        (pass-through!))
      ;; BL-960: safe-wrapper-command parse-checks the composition (bash -n)
      ;; and returns nil when it does not parse - fail-open to the
      ;; byte-untouched original via the same {} no-op every other
      ;; pass-through case uses, with no narration on any stream.
      (let [wrapper (tool-miss-heal-lib/safe-wrapper-command command pinned-worktree)]
        (if wrapper
          ;; Merge command into the existing tool_input so qwen's
          ;; run_shell_command keeps description/other fields (qwen replaces
          ;; tool_input wholesale with updatedInput).
          (println (json/generate-string
                    {:hookSpecificOutput
                     {:hookEventName "PreToolUse"
                      :updatedInput (assoc tool-input :command wrapper)}}))
          (pass-through!))))))

(apply -main *command-line-args*)
