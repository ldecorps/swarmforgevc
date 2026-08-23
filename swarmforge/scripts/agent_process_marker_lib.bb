;; agent_process_marker_lib.bb — ONE token→argv-needle map for live-seat
;; process detection (BL-1108). babysitter_check.bb and swarm_ensure.bb both
;; load this so Cursor/`local-model`/… seats cannot drift between half-launch
;; CRIT wording and `./swarm ensure` heal probes.
;;
;; Load:
;;   (load-file ... "agent_process_marker_lib.bb")
;;   agent-process-marker-lib/agent-process-marker "cursor"
;;
;; Keep needles aligned with swarmforge.sh launch binaries. Token and
;; executable may differ (cursor → cursor-agent; local-model → qwen).

(ns agent-process-marker-lib)

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
