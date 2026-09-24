#!/usr/bin/env bb
;; Executes agent-runtime step sequences against tmux (inject adapter).
(ns agent-runtime-inject
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "agent_runtime_lib.bb")))
;; BL-967: subprocess waits are bounded at the shared chokepoint - this
;; lib runs inside handoffd's poll cycle (wake delivery, chase, context-clear).
(load-file (str (fs/path scripts-dir "daemon_cycle_guard_lib.bb")))

(def notify-max-retries 3)
(def notify-retry-delay-ms 200)

(defn tmux! [& args]
  (apply daemon-cycle-guard-lib/sh! "tmux" args))

(defn capture-pane-text [socket session]
  (:out (tmux! "-S" socket "capture-pane" "-p" "-t" session)))

(defn last-non-blank-line [pane-text]
  (last (remove str/blank? (str/split-lines (or pane-text "")))))

(defn pending-input-line [pane-text]
  (let [line (last-non-blank-line pane-text)]
    (if (nil? line)
      ""
      (if-let [[_ tail] (re-find #"[$#❯>]\s*(\S.*)?$" line)]
        (str/trim (or tail ""))
        ""))))

(defn pending-input? [pane-text]
  (not (str/blank? (pending-input-line pane-text))))

(defn text-still-pending? [pane-text text]
  (let [pending (pending-input-line pane-text)]
    (and (not (str/blank? pending)) (str/includes? pending (str/trim text)))))

(defn send-submit! [socket session]
  (let [cr (tmux! "-S" socket "send-keys" "-t" session "C-m")]
    (Thread/sleep 50)
    (let [lf (tmux! "-S" socket "send-keys" "-t" session "C-j")]
      (and (zero? (:exit cr)) (zero? (:exit lf))))))

(defn execute-step! [socket session step]
  (case (:op step)
    :sleep (Thread/sleep (:ms step))
    :send-literal
    (let [res (tmux! "-S" socket "send-keys" "-t" session "-l" (:text step))]
      (when-not (zero? (:exit res))
        (throw (ex-info "tmux send-literal failed" res)))
      (Thread/sleep 150))
    :paste-file
    (let [path (:path step)
          res (tmux! "-S" socket "load-buffer" "-b" "swarmforge-bootstrap" path)]
      (when-not (zero? (:exit res))
        (throw (ex-info "tmux load-buffer failed" res)))
      (let [paste (tmux! "-S" socket "paste-buffer" "-d" "-t" session "-b" "swarmforge-bootstrap")]
        (when-not (zero? (:exit paste))
          (throw (ex-info "tmux paste-buffer failed" paste)))
        (Thread/sleep 150)))
    :submit
    (when-not (send-submit! socket session)
      (throw (ex-info "tmux submit failed" {:session session})))
    (throw (ex-info "unknown agent-runtime step" step))))

(defn execute-steps! [socket session steps]
  (doseq [step steps]
    (execute-step! socket session step)))

(defn notify-max-retries-for [agent]
  (case (agent-runtime-lib/normalize-agent agent)
    "aider" 10
    notify-max-retries))

(defn notify-retry-delay-ms-for [agent attempt]
  (case (agent-runtime-lib/normalize-agent agent)
    "aider" (* 500 attempt)
    (* notify-retry-delay-ms attempt)))

;; 2026-09-21 (Claude Code, operator request): an explicit :text override
;; reaches the pane completely as-is for a chat-style agent, but a
;; shell-run-script agent (aider) has no concept of "reply to this message"
;; distinct from "edit a file" - without the same ban-on-prose-plus-literal-
;; fallback suffix the aider bootstrap paste already carries
;; (prompt-engine-lib/aider-no-narration-suffix), any OTHER injected text
;; (a babysitter health-sweep nudge, a chase wake, ...) got the same
;; narrate-or-edit response the bootstrap paste used to get. Observed live:
;; a babysitter nudge into the qwen2.5-coder mono-router coordinator
;; produced a hallucinated rewrite of ready_for_next.sh (discarded only
;; because this seat runs --dry-run). Applied once here so every caller of
;; notify-agent! - not just the bootstrap path - gets it for free.
(defn- text-for-agent
  "fallback-command is the literal command the no-narration suffix tells the
   agent to reply with verbatim when it has nothing to do - defaults to
   ready-script-rel-path (the correct idle action for a normal wake).
   Callers injecting a message that itself PROHIBITS that exact command
   (e.g. in-process-resume) must pass prompt-engine-lib/safe-idle-fallback-
   command instead, or the appended fallback reinstates the prohibition the
   caller's own text just stated."
  [agent text & {:keys [fallback-command]}]
  (if (= :shell-run-script (:wake-style (agent-runtime-lib/capabilities agent)))
    (str text prompt-engine-lib/aider-no-narration-suffix
         (or fallback-command prompt-engine-lib/ready-script-rel-path) "`")
    text))

(defn notify-agent!
  "Agent-aware wake with verified submit (replaces one-size-fits-all chat
   wake). An optional :text overrides the agent's default wake message with
   caller-supplied literal instruction text (BL-258's briefing-due nudge is
   the first caller), reusing the exact same capture/submit/retry/confirm
   machinery as the default wake - never a second, duplicated send path.
   :fallback-command (only meaningful alongside :text) overrides the no-
   narration suffix's literal \"nothing to do\" fallback - see text-for-
   agent's docstring; omitted, every existing caller keeps today's
   ready-script-rel-path fallback byte-for-byte.
   :raw? true (BL-1697) sends :text completely as-is - no
   aider-no-narration-suffix appended regardless of the agent's wake-style.
   For the local parcel driver's own messages (chat-set commands, the one
   instruction, a fix request), which must be free of any suffix the
   driver itself did not write - a raw path added NEXT TO text-for-agent's
   suffix logic, never a strip-after-the-fact on the same text."
  [socket session agent & {:keys [log-fn on-outcome script-rel-path text fallback-command raw?]}]
  (let [steps (if text
                [{:op :send-literal :text (if raw? text (text-for-agent agent text :fallback-command fallback-command))} {:op :submit}]
                (agent-runtime-lib/wake-steps agent :script-rel-path script-rel-path))
        wake-text (:text (first (filter #(= :send-literal (:op %)) steps)))
        log! (or log-fn (fn [& _] nil))
        report! (or on-outcome (fn [& _] nil))
        before (capture-pane-text socket session)
        stacked? (pending-input? before)
        pending-text (if stacked? (pending-input-line before) wake-text)]
    (when-not stacked?
      (doseq [step (filter #(not= :submit (:op %)) steps)]
        (execute-step! socket session step)))
    (loop [attempt 1]
      (when-not (send-submit! socket session)
        (report! "error" "tmux send submit failed" attempt stacked?)
        (throw (ex-info "tmux send submit failed" {:session session})))
      (let [capture (capture-pane-text socket session)]
        (cond
          (agent-runtime-lib/wake-delivery-confirmed? agent capture pending-text)
          (do (report! "ok" nil attempt stacked?) :ok)

          (>= attempt (notify-max-retries-for agent))
          (let [detail (if stacked?
                         "pane already held undelivered input and it still would not submit"
                         (str "submit not confirmed after " attempt " attempt(s)"))]
            (log! "notify-delivery-failed" session detail)
            (report! "failed" detail attempt stacked?)
            :failed)

          :else
          (do
            (Thread/sleep (notify-retry-delay-ms-for agent attempt))
            (recur (inc attempt))))))))

(defn run-bootstrap! [socket session agent role prompt-file two-pack? & [overlay-prompt]]
  (let [steps (agent-runtime-lib/bootstrap-steps agent role
                                                 :two-pack? two-pack?
                                                 :overlay-prompt overlay-prompt
                                                 :prompt-file prompt-file)]
    (execute-steps! socket session steps)))
