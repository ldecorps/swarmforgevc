;; agent_process_marker_lib.bb — ONE token→argv-needle map for live-seat
;; process detection (BL-1108). babysitter_check.bb and swarm_ensure.bb both
;; load this so Cursor/`local-model`/… seats cannot drift between half-launch
;; CRIT wording and `./swarm ensure` heal probes.
;;
;; Also owns the shared ps snapshot + child-of-pane argv probe (BL-1019) so
;; `./swarm status` and babysitter cannot disagree on "is the agent under
;; this pane?" — pane_current_command is never consulted.
;;
;; Load:
;;   (load-file ... "agent_process_marker_lib.bb")
;;   agent-process-marker-lib/agent-process-marker "cursor"
;;
;; Keep needles aligned with swarmforge.sh launch binaries. Token and
;; executable may differ (cursor → cursor-agent; local-model → qwen).

(ns agent-process-marker-lib
  (:require [babashka.process :as process]
            [clojure.string :as str]))

(def agent-process-markers
  {"claude"      "claude "
   "cursor"      "cursor-agent"
   "gemini"      "gemini"
   "codex"       "codex"
   "vibe"        "vibe"
   "aider"       "aider"
   "copilot"     "copilot"
   "grok"        "grok"
   ;; BL-1052: agent TOKEN is local-model; first-quest binary is qwen.
   "local-model" "qwen"})

(defn agent-process-marker
  "Substring to look for in a child process argv for this agent token.
   Unknown tokens fall back to the token itself (still better than always
   looking for claude)."
  [agent]
  (let [token (or agent "claude")]
    (get agent-process-markers token (str token " "))))

;; BL-802 / BL-1019: `ps --ppid` is GNU-only. One `ps -eo` snapshot works on
;; both dialects — filter by ppid in-process. One snapshot covers every role.
(def ps-line-pattern #"^\s*(\d+)\s+(\d+)\s+(.*)$")

(defn ps-snapshot
  "Full process table text, or nil when ps fails (caller must treat as
   gather-failed — never as 'no agent')."
  []
  (let [r (process/sh "ps" "-eo" "pid=,ppid=,args=")]
    (when (zero? (:exit r)) (:out r))))

(defn agent-process-line
  "First child of pane-pid whose args match the expected agent marker, or nil.
   Formerly claude-only (`claude `); Cursor seats run `cursor-agent`."
  [pane-pid ps-output agent]
  (when (and pane-pid ps-output)
    (let [marker (agent-process-marker agent)]
      (->> (str/split-lines ps-output)
           (keep (fn [line]
                   (when-let [[_ _pid ppid args] (re-find ps-line-pattern line)]
                     (when (= (str pane-pid) ppid) args))))
           (filter #(str/includes? % marker))
           first))))
