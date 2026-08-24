;; agent_process_marker_lib.bb — ONE token→argv-needle map for live-seat
;; process detection (BL-1108). babysitter_check.bb and swarm_ensure.bb both
;; load this so Cursor/`local-model`/… seats cannot drift between half-launch
;; CRIT wording and `./swarm ensure` heal probes.
;;
;; Also owns the shared ps snapshot + under-pane argv probe (BL-1019 / BL-1070)
;; so `./swarm status` and babysitter cannot disagree on "is the agent under
;; this pane?" — pane_current_command is never consulted. BL-1070: match any
;; descendant of the pane, not only a direct child (wrapper shells sit between).
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

(defn- parse-ps-entries [ps-output]
  (->> (str/split-lines (or ps-output ""))
       (keep (fn [line]
               (when-let [[_ pid ppid args] (re-find ps-line-pattern line)]
                 {:pid pid :ppid ppid :args args})))))

(defn- descendant-pid-set
  "Pids reachable under root-pid via ppid edges (root itself excluded)."
  [entries root-pid]
  (let [by-ppid (group-by :ppid entries)
        root (str root-pid)]
    (loop [frontier [root]
           seen #{}]
      (if (empty? frontier)
        seen
        (let [pid (first frontier)
              kids (map :pid (get by-ppid pid []))
              fresh (remove seen kids)]
          (recur (into (vec (rest frontier)) fresh)
                 (into seen fresh)))))))

(defn agent-process-line
  "First process under pane-pid (any generation) whose args match the expected
   agent marker, or nil. BL-1070: wrapper shells put claude at depth 2+; a
   direct-child-only match false-CRIT'd every healthy pack role. Never matches
   a process outside this pane's own tree (invariant 2)."
  [pane-pid ps-output agent]
  (when (and pane-pid ps-output)
    (let [marker (agent-process-marker agent)
          entries (parse-ps-entries ps-output)
          under (descendant-pid-set entries pane-pid)]
      (->> entries
           (filter #(contains? under (:pid %)))
           (filter #(str/includes? (:args %) marker))
           (map :args)
           first))))
