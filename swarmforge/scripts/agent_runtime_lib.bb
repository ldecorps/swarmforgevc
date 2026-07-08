#!/usr/bin/env bb
;; Agent runtime facade — pure strategy (no tmux). Callers use the same
;; operations; agent-specific syntax lives here only.
(ns agent-runtime-lib
  (:require [clojure.string :as str]))

(def supported-agents #{"claude" "aider" "grok" "codex" "copilot" "mock"})

(def handoff-draft-rel-path "swarmforge/runtime/handoff-draft.txt")

(def ready-script-rel-path "swarmforge/scripts/ready_for_next.sh")

(def default-wake-chat-message
  "You have new handoff mail. If idle, run ready_for_next.sh.")

(defn normalize-agent
  "Unknown agents fall back to claude chat-style wake."
  [agent]
  (let [a (some-> agent str/lower-case str/trim)]
    (if (contains? supported-agents a) a "claude")))

(defn context-files
  [role & {:keys [two-pack? overlay-prompt]}]
  (into ["swarmforge/constitution.prompt"
         "swarmforge/PIPELINE.md"
         (str "swarmforge/roles/" role ".prompt")]
        (concat (when two-pack? ["swarmforge/packs/two-pack.prompt"])
                (when (and overlay-prompt (not (str/blank? overlay-prompt)))
                  [overlay-prompt]))))

(defn handoff-draft-path
  "Writable by all runtimes (not under .swarmforge/ or repo-root tmp/)."
  [_agent]
  handoff-draft-rel-path)

(defn run-script-literal
  "What to type into the agent pane to execute a repo-relative script."
  [agent script-rel-path]
  (case (normalize-agent agent)
    "aider" (str "! ./" script-rel-path)
    (str "Run ./" script-rel-path)))

(def aider-shell-output-re
  #"Added \d+ lines of output to the chat|(?m)^(TASK:|NO_TASK|DRAINING)")

(defn extract-pending-input
  "Text after the prompt on the last non-blank pane line (tmux capture-pane)."
  [pane-text]
  (let [line (last (remove str/blank? (str/split-lines (or pane-text ""))))]
    (if (nil? line)
      ""
      (if-let [[_ tail] (re-find #"[$#❯>]\s*(\S.*)?$" line)]
        (str/trim (or tail ""))
        ""))))

(defn wake-delivery-confirmed?
  "Agent-specific post-submit confirmation (aider !-commands need extra time)."
  [agent pane-text pending-text]
  (let [pending (extract-pending-input pane-text)
        text (str/trim pending-text)
        still? (and (not (str/blank? pending)) (str/includes? pending text))]
    (case (normalize-agent agent)
      "aider"
      (or (not still?)
          (some? (re-find aider-shell-output-re pane-text)))
      (not still?))))

(defn wake-steps
  "Steps to nudge an idle agent to pick up inbox mail."
  [agent & {:keys [script-rel-path]}]
  (let [script (or script-rel-path ready-script-rel-path)
        text (case (normalize-agent agent)
               "mock" "MOCK_WAKE"
               "aider" (run-script-literal "aider" script)
               default-wake-chat-message)]
    [{:op :send-literal :text text}
     {:op :submit}]))

(defn bootstrap-steps
  "Post-launch tmux steps. Claude embeds prompt in launch script — no steps."
  [agent role & {:keys [two-pack? overlay-prompt prompt-file startup-delay-ms]}]
  (case (normalize-agent agent)
    "aider" (concat [{:op :sleep :ms (or startup-delay-ms 5000)}]
                    [{:op :send-literal
                      :text (str "/add " (str/join " " (context-files role
                                                           :two-pack? two-pack?
                                                           :overlay-prompt overlay-prompt)))}
                     {:op :submit}
                     {:op :sleep :ms 2000}
                     {:op :paste-file :path prompt-file}
                     {:op :submit}])
    "grok" [{:op :sleep :ms (or startup-delay-ms 3000)}
            {:op :paste-file :path prompt-file}
            {:op :submit}]
    "mock" [{:op :send-literal :text "MOCK_BOOTSTRAP"}
            {:op :submit}]
    []))

(defn mock-bootstrap-text [role]
  (str "MOCK_BOOTSTRAP_TEXT role=" role))

(defn bootstrap-text
  [agent role & {:keys [two-pack? overlay-prompt coordinator-two-pack-note]}]
  (let [draft (handoff-draft-path agent)
        two-pack? (boolean two-pack?)
        overlay (not (str/blank? overlay-prompt))
        coord-note (or coordinator-two-pack-note
                       (when two-pack?
                         " This pack has no specifier: promote items from backlog/paused into backlog/active (respect active_backlog_max_depth), then send task handoffs directly to coder."))]
    (case (normalize-agent agent)
      "aider"
      (if (= role "coordinator")
        (str "You are the SwarmForge coordinator in aider." coord-note
             " You are an ORCHESTRATOR ONLY — read swarmforge/roles/coordinator.prompt and obey it. "
             "Your job: inspect .swarmforge/ and backlog/, route parcels with swarm_handoff.sh, chase stalls, control intake. "
             "NEVER edit production code, tests, or swarmforge/scripts; NEVER commit domain or infrastructure changes yourself — that is coder/cleaner work. "
             "Do not rewrite ready_for_next.sh, handoffd, or other pipeline machinery unless a human explicitly ordered it. "
             "You may read any file; do not use aider to apply edits. "
             "Handoff drafts go in " draft " (never repo-root tmp/ or .swarmforge/ — aider skips gitignored paths). "
             "Then run `" ready-script-rel-path "` once and wait for wake-ups. "
             "No self-scheduled polling (/loop, cron, or \"check again in N minutes\").")
        (str "You are the SwarmForge " role " agent running in aider with full repository read and write access. "
             "Never claim you cannot read or edit files — that is what aider does. "
             "The files just added are your constitution, pipeline, and role instructions. Read each one completely. "
             "For constitution.prompt and swarmforge/roles/" role ".prompt, also read every file they reference recursively, and obey all instructions. "
             "Handoff drafts: " draft ". "
             "Then run `" ready-script-rel-path "` once and wait for work. "
             "Do not self-schedule polling (/loop, cron, or \"check again in N minutes\")."))

      "mock" (mock-bootstrap-text role)

      (str "Read swarmforge/constitution.prompt, then read every file it refers to recursively, and obey all of those instructions.\n"
           "Read swarmforge/PIPELINE.md and follow the parcel flow for your role.\n"
           "Read swarmforge/roles/" role ".prompt, then read every file it refers to recursively, and follow all of those instructions.\n"
           (when two-pack?
             (str "Read swarmforge/packs/two-pack.prompt and follow it for this pack.\n"
                  "Handoff drafts: write to " draft " then run swarmforge/scripts/swarm_handoff.sh on that file. Never use repo-root tmp/ for drafts (gitignored).\n"))
           (when overlay
             (str "Read " overlay-prompt " and follow it for this swarm profile.\n"
                  (when (not two-pack?)
                    (str "Handoff drafts: write to " draft " then run swarmforge/scripts/swarm_handoff.sh on that file. Never use repo-root tmp/ for drafts (gitignored).\n"))))
           (when (and (= role "coordinator") (or two-pack? overlay))
             "To route the top active backlog item to coder mechanically: swarmforge/scripts/route_backlog_to_coder.sh\n")))))

(defn needs-tmux-bootstrap?
  [agent]
  (seq (bootstrap-steps agent "coder")))
