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
;; BL-960: composition is parse-checked and byte-faithful. The original
;; command is embedded as a multi-line (\n...\n) subshell group captured to
;; a temp file and replayed with cat - never spliced inline into a $( ... )
;; substitution, which swallowed heredoc bodies, let a literal ")" close the
;; substitution early, and stripped trailing newlines (the 2026-08-19
;; incident: silent-PARTIAL syntax errors, QA stalled 50 minutes). Anything
;; that still cannot compose (an unterminated heredoc swallows the group's
;; own closer) fail-opens to the byte-untouched original, silently -
;; safe-wrapper-command below, the one function in this module that may
;; touch a subprocess (the bash -n parse gate, injectable as a seam).
(ns tool-miss-heal-lib
  (:require [babashka.process :as process]
            [clojure.string :as str]))

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
;;
;; BL-934: :missing-root-argv references the worktree via the $__sfh_root
;; shell variable (defined once in build-healing-wrapper-command below),
;; never as a literal path spliced directly next to original-command. A
;; literal `original-command 'pinned-worktree'` is exactly what Claude
;; Code's own dangerous-rm classifier reads as "rm of the worktree"
;; whenever original-command happens to be an rm invocation - even though
;; this branch only ever RUNS for a non-rm CLI's genuine missing
;; <project-root> usage error (rm's own failures never match this class's
;; patterns), the classifier scans the wrapper's whole STATIC source before
;; anything executes, dead branches included. original-command's own text
;; is untouched here - never hidden, never encoded - so a genuine rm of the
;; worktree already present in original-command stays fully visible
;; (invariant 2); only the SYNTHETIC appended argument's representation
;; changes.
;; BL-960 defect 2: appending a trailing argument is only well-defined for a
;; SINGLE SIMPLE command - on a pipeline or ;-sequence it lands on the final
;; segment, not the program that produced the usage error (observed live:
;; echo "---done---" "$__sfh_root"). Conservatively true only for a single
;; line with no shell control operators, redirections, substitutions,
;; grouping, or escapes - quoted or not (quote-awareness would need a real
;; parser, and the asymmetry decides it: a false negative merely DECLINES a
;; heal, returning the failure as-is per the classifier's own conservative
;; posture; a false positive misdirects the append, the exact live defect).
(defn single-simple-command?
  [command]
  (let [c (or command "")]
    (boolean (and (not (str/blank? c))
                  (not (re-find #"[|;&<>()`\n\\]" c))))))

(defn healed-command
  [miss-class original-command pinned-worktree]
  (case miss-class
    ;; The cd-heals re-anchor the WHOLE original via a subshell group - for
    ;; a multi-command original, every segment (not just the first) re-runs
    ;; from the healed directory, so the rewrite's target stays well-defined
    ;; for any shape (BL-960 invariant 3).
    :wrong-cwd (str "cd " (shell-quote pinned-worktree) " && (\n" original-command "\n)")
    :wrong-surface (str "cd " (shell-quote (str pinned-worktree "/extension")) " && (\n" original-command "\n)")
    ;; nil when the append target is ambiguous: the clause is omitted from
    ;; the wrapper entirely and the failure returns as-is (:real-failure
    ;; posture), never a syntactically valid but misdirected re-run.
    :missing-root-argv (when (single-simple-command? original-command)
                         (str original-command " \"$__sfh_root\""))
    nil))

(defn- bash-clause
  [first? pattern healed]
  (str (if first? "  if" "  elif") " grep -qiE " (shell-quote pattern) " \"$__sfh_out_file\"; then\n"
       "    (\n" healed "\n    ) > \"$__sfh_out_file\" 2>&1; __sfh_ec=$?\n"))

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
  ;; BL-960: the original runs inside a multi-line (\n...\n) subshell group
  ;; (heredocs, literal parens, nested quotes, pipelines and ;-sequences all
  ;; parse exactly as they would standalone; an `exit` stays contained, as
  ;; it was under the old $()-capture), redirected WHOLE to a temp file
  ;; (`> file 2>&1` outside the group merges both streams for every
  ;; segment, matching the unwrapped command run with 2>&1) and replayed
  ;; with cat - byte-exact, trailing bytes included, where $()-capture
  ;; stripped trailing newlines. Classes whose heal declines for this
  ;; command's shape (healed-command returns nil) are omitted from the
  ;; chain entirely, falling through to :real-failure.
  (let [active (keep (fn [[cls pattern]]
                       (when-let [healed (healed-command cls original-command pinned-worktree)]
                         [pattern healed]))
                     MISS-CLASS-PATTERNS)
        clauses (apply str
                       (map-indexed
                        (fn [i [pattern healed]] (bash-clause (zero? i) pattern healed))
                        active))]
    (str "__sfh_root=" (shell-quote pinned-worktree) "\n"
         "__sfh_out_file=\"$(mktemp \"${TMPDIR:-/tmp}/sfh.XXXXXX\")\" || exit 1\n"
         "(\n"
         original-command "\n"
         ") > \"$__sfh_out_file\" 2>&1; __sfh_ec=$?\n"
         (if (seq active)
           (str "if [ $__sfh_ec -ne 0 ]; then\n"
                clauses
                "  fi\n"
                "fi\n")
           "")
         "cat \"$__sfh_out_file\"\n"
         "rm -f \"$__sfh_out_file\"\n"
         "exit $__sfh_ec\n")))

;; The parse gate (BL-960 invariant 1): true only when bash itself can parse
;; wrapper-text (`bash -n -c` reads the text without executing anything).
;; The one subprocess boundary in this module; anything unexpected is false
;; (fail toward "do not hand this to Claude Code"), never an exception.
(defn wrapper-parses?
  [wrapper-text]
  (try
    (zero? (:exit (process/sh ["bash" "-n" "-c" wrapper-text])))
    (catch Exception _ false)))

;; What the hook actually calls: composes the wrapper and returns it ONLY
;; when the composition parses as bash; nil means fail-open - the caller
;; hands back the byte-untouched original with no narration (BL-913's
;; locked decision 5, "the first miss must not reach the model as a
;; confession", extended to the wrapper's own composition failures).
;; parses? is the injectable parse-gate seam; the 2-arity uses the real
;; bash -n gate. A parse gate that THROWS also fail-opens.
(defn safe-wrapper-command
  ([original-command pinned-worktree]
   (safe-wrapper-command original-command pinned-worktree wrapper-parses?))
  ([original-command pinned-worktree parses?]
   (let [wrapper (build-healing-wrapper-command original-command pinned-worktree)]
     (when (try (boolean (parses? wrapper)) (catch Exception _ false))
       wrapper))))
