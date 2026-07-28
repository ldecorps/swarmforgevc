;; BL-657: pure decision logic for which environment variable NAMES are
;; Claude-Code-harness session markers that must never leak into a role's
;; tmux pane, regardless of which shell (cron-clean vs. operator/harness-
;; descended) started the swarm's tmux server.
;;
;; INCIDENT: three identical failures in one night - a tmux server created
;; from an operator/harness-descended shell died 1-3s after session
;; creation, while the same launch from cron (clean env) and from a
;; manually-scrubbed session both survived. Forensics found
;; CLAUDE_CODE_CHILD_SESSION leaking into the manually-assembled sessions
;; (tmux's global environment is seeded from whatever process starts the
;; server); the fix scrubs any such marker from the server's global
;; environment right after session creation, before launch_role's
;; respawn-pane spawns the real agent process.
;;
;; NOT swept: CLAUDE_CODE_MAX_OUTPUT_TOKENS - swarmforge.sh's launch_role
;; already reads this deliberately from the LAUNCHER's own process env and
;; re-passes it via respawn-pane's `-e` (see swarmforge.sh's
;; provider_env_flags), independent of whatever tmux's global environment
;; holds. Scrubbing it here would be a no-op for that passthrough but a
;; misleading exclusion to omit from this list, so it stays off the scrub
;; set explicitly rather than by accident.

(ns harness-env-scrub-lib
  (:require [clojure.string :as str]))

(def ^:private deliberate-passthrough-vars
  "Names launch_role already reads from the launcher's own env and re-passes
   explicitly via respawn-pane -e - never scrub these even though they share
   the CLAUDE_CODE_ prefix."
  #{"CLAUDE_CODE_MAX_OUTPUT_TOKENS"})

(defn harness-marker-var?
  "Is `name` a Claude Code harness/session marker that must be scrubbed from
   the tmux server's global environment before any role pane is spawned?
   Matches the bare CLAUDECODE flag and any CLAUDE_CODE_* name, except the
   small deliberate-passthrough allowlist above. nil/blank names are never
   markers."
  [name]
  (boolean
    (and (not (str/blank? name))
         (not (contains? deliberate-passthrough-vars name))
         (or (= name "CLAUDECODE")
             (str/starts-with? name "CLAUDE_CODE_")))))

(defn env-var-name
  "Extracts the variable name from one line of `tmux show-environment -g`
   output, which is either `NAME=value` (set) or `-NAME` (marked unset) -
   the latter has no value to leak so it is returned as-is for the caller to
   filter out (an unset marker is not itself a leak)."
  [line]
  (when-not (str/blank? line)
    (let [trimmed (str/trim line)]
      (if (str/starts-with? trimmed "-")
        nil
        (first (str/split trimmed #"=" 2))))))

(defn harness-marker-names
  "Given the raw multi-line output of `tmux show-environment -g`, returns the
   distinct variable names that are harness markers needing a scrub -
   pure text-in/data-out so the impure `tmux set-environment -u` loop around
   it is a thin, untested-by-necessity shell shim."
  [show-environment-output]
  (->> (str/split-lines (or show-environment-output ""))
       (map env-var-name)
       (filter harness-marker-var?)
       distinct
       vec))
