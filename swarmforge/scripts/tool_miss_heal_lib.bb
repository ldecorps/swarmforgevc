;; BL-913 (epic tool-miss-auto-heal, slice A): pure classify+heal logic for
;; one recoverable shell "miss" - the pinned-execution-environment PreToolUse
;; hook (tool_miss_heal_hook.bb) is the thin, untested I/O boundary that
;; reads the hook JSON and calls build-healing-wrapper-command below; every
;; decision lives here, testable with no real subprocess, no real git, no
;; real npm.
;;
;; The human's own framing: "stop teaching the model to be a careful shell;
;; make the shell un-wrong, heal one miss in silence, then fail honestly."
;; Locked decision 5 ("the first miss must not reach the model as a
;; confession") is only satisfiable if classification and retry happen
;; inside the ONE shell invocation Claude Code's Bash tool actually performs
;; - so build-healing-wrapper-command below does not itself run anything; it
;; returns a self-contained bash snippet that runs the original command,
;; classifies a failure, and re-runs ONCE from the healed environment, all
;; inside that one invocation. The model never observes an intermediate
;; failed attempt.
(ns tool-miss-heal-lib
  (:require [clojure.string :as str]))

;; Closed taxonomy of recoverable shell misses - a shape to copy from
;; agent_runtime_lib.bb's own error-category-patterns, not a table to extend
;; in place (this classifies a SINGLE INVOCATION's own output, not a
;; provider launch failure). Patterns are plain strings, matched
;; case-insensitively via an explicit (?i) toggle on the Clojure side and an
;; explicit -i flag on the bash side - never a Java-only inline (?i) baked
;; into the literal - because this SAME literal text is also spliced into a
;; generated bash `grep -qiE` snippet (build-healing-wrapper-command below).
;; One canonical pattern per class, never two hand-authored copies that
;; could drift (BL-897 lesson: a constant mirrored by hand across a language
;; boundary no import can bridge needs a shared source, not a "kept in sync"
;; comment).
(def MISS-CLASS-PATTERNS
  [[:wrong-cwd "fatal: not a git repository"]
   [:wrong-surface "npm error code enoent|could not read package\\.json|no such file or directory.*package\\.json"]
   [:missing-root-argv "usage:.*<project-root>|usage:.*<target-repo-path>|missing required argument"]])

;; The classifier must be conservative (per this ticket's own description):
;; anything it is not sure about is a real failure, never silently retried.
;; `some` stops at the FIRST matching class, in MISS-CLASS-PATTERNS' own
;; order - build-healing-wrapper-command's generated if/elif chain below
;; mirrors this exact order and first-match-wins semantics, so the two never
;; disagree about which class fired.
(defn classify-miss
  [output]
  (let [haystack (or output "")
        match (some (fn [[cls pattern]]
                       (when (re-find (re-pattern (str "(?i)" pattern)) haystack) cls))
                     MISS-CLASS-PATTERNS)]
    (or match :real-failure)))

(defn shell-quote
  "Single-quotes s for safe splicing into a generated bash snippet - the
   only character that needs special handling inside single quotes is a
   literal single quote itself, closed/escaped/reopened."
  [s]
  (str "'" (str/replace s "'" "'\\''") "'"))

;; Given the miss class a failure classified as, returns the command text to
;; re-run ONCE from the healed environment - nil for :real-failure, which is
;; never re-run at all. :missing-root-argv appends the pinned worktree as a
;; trailing positional argument (the shape every CLI this ticket's own
;; description names - propose-onboarding-prompts.js and its siblings - take
;; <project-root>-like args); :wrong-cwd and :wrong-surface re-anchor via cd.
(defn healed-command
  [miss-class original-command pinned-worktree]
  (case miss-class
    :wrong-cwd (str "cd " (shell-quote pinned-worktree) " && " original-command)
    :wrong-surface (str "cd " (shell-quote (str pinned-worktree "/extension")) " && " original-command)
    :missing-root-argv (str original-command " " (shell-quote pinned-worktree))
    nil))

(defn- bash-clause
  [first? [cls pattern] original-command pinned-worktree]
  (let [keyword (if first? "if" "elif")
        healed (healed-command cls original-command pinned-worktree)]
    (str keyword " printf '%s' \"$__sfh_out\" | grep -qiE " (shell-quote pattern) "; then\n"
         "    __sfh_out=$(" healed " 2>&1); __sfh_ec=$?\n")))

;; The whole self-healing wrapper, as bash source text - this is what
;; becomes the PreToolUse hook's updatedInput.command (tool_miss_heal_hook.bb's
;; own job to splice in). Runs the ORIGINAL command exactly as issued first
;; (scenario 04: a command that succeeds as issued is untouched, and NOTHING
;; here fires unless it fails); on failure, an if/elif chain (mirroring
;; classify-miss's own first-match-wins order EXACTLY, so the two can never
;; disagree) checks the failure's own output against each recoverable
;; class's pattern and, for at most ONE of them, re-runs once from the
;; healed environment. Because it is an if/elif chain (not independent `if`
;; statements), at most one branch ever fires regardless of what the healed
;; re-run's own output happens to contain - invariant 1 ("no classification
;; path produces a second retry") holds structurally, not by convention.
;; Anything that matches no class (:real-failure) falls through every
;; branch untouched. The final __sfh_out/__sfh_ec - whichever attempt
;; produced them - is the only thing printed, so the model observes exactly
;; one result no matter how many of the up-to-two attempts actually ran.
(defn build-healing-wrapper-command
  [original-command pinned-worktree]
  (let [clauses (apply str
                        (map-indexed
                         (fn [i entry] (bash-clause (zero? i) entry original-command pinned-worktree))
                         MISS-CLASS-PATTERNS))]
    (str "__sfh_out=$(" original-command " 2>&1); __sfh_ec=$?\n"
         "if [ $__sfh_ec -ne 0 ]; then\n"
         clauses
         "  fi\n"
         "fi\n"
         "printf '%s' \"$__sfh_out\"\n"
         "exit $__sfh_ec\n")))
