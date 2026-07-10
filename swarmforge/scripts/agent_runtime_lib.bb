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

;; ── BL-206: provider capability model ─────────────────────────────────────
;; Every orchestration decision below reads a capability flag off this map,
;; never branches on the raw provider name via case/cond
;; (capability-branching-01). One entry per supported-agents member.
;; Adding a provider is adding one entry here - no existing function's own
;; logic changes (new-provider-is-capabilities-02); only a provider whose
;; wording is genuinely novel (like aider's) also needs a new text-builder
;; registered in bootstrap-text-builders below, since capability flags
;; alone can route to prose, not invent it.
(def provider-capabilities
  {"claude"  {:wake-style :chat-message
              :bootstrap-style :embedded
              :bootstrap-text-style :generic}
   "codex"   {:wake-style :chat-message
              :bootstrap-style :embedded
              :bootstrap-text-style :generic}
   "copilot" {:wake-style :chat-message
              :bootstrap-style :embedded
              :bootstrap-text-style :generic}
   "grok"    {:wake-style :chat-message
              :bootstrap-style :paste-prompt-file
              :bootstrap-text-style :generic
              :startup-delay-ms 3000}
   "aider"   {:wake-style :shell-run-script
              :bootstrap-style :add-files-then-paste
              :bootstrap-text-style :aider
              :startup-delay-ms 5000}
   "mock"    {:wake-style :mock
              :bootstrap-style :mock
              :bootstrap-text-style :mock}})

(defn capabilities [agent]
  (get provider-capabilities (normalize-agent agent)))

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
  (case (:wake-style (capabilities agent))
    :shell-run-script (str "! ./" script-rel-path)
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
  "Agent-specific post-submit confirmation (shell-run-script providers like
   aider need extra time before the shell command's own output appears)."
  [agent pane-text pending-text]
  (let [pending (extract-pending-input pane-text)
        text (str/trim pending-text)
        still? (and (not (str/blank? pending)) (str/includes? pending text))]
    (if (= :shell-run-script (:wake-style (capabilities agent)))
      (or (not still?)
          (some? (re-find aider-shell-output-re pane-text)))
      (not still?))))

(defn wake-steps
  "Steps to nudge an idle agent to pick up inbox mail."
  [agent & {:keys [script-rel-path]}]
  (let [script (or script-rel-path ready-script-rel-path)
        text (case (:wake-style (capabilities agent))
               :mock "MOCK_WAKE"
               :shell-run-script (run-script-literal agent script)
               default-wake-chat-message)]
    [{:op :send-literal :text text}
     {:op :submit}]))

(defn bootstrap-steps
  "Post-launch tmux steps. :embedded providers embed the prompt in their
   launch script - no steps."
  [agent role & {:keys [two-pack? overlay-prompt prompt-file startup-delay-ms]}]
  (let [caps (capabilities agent)
        delay-ms (or startup-delay-ms (:startup-delay-ms caps))]
    (case (:bootstrap-style caps)
      :add-files-then-paste
      (concat [{:op :sleep :ms (or delay-ms 5000)}]
              [{:op :send-literal
                :text (str "/add " (str/join " " (context-files role
                                                     :two-pack? two-pack?
                                                     :overlay-prompt overlay-prompt)))}
               {:op :submit}
               {:op :sleep :ms 2000}
               {:op :paste-file :path prompt-file}
               {:op :submit}])
      :paste-prompt-file
      [{:op :sleep :ms (or delay-ms 3000)}
       {:op :paste-file :path prompt-file}
       {:op :submit}]
      :mock
      [{:op :send-literal :text "MOCK_BOOTSTRAP"}
       {:op :submit}]
      [])))

(defn mock-bootstrap-text [role]
  (str "MOCK_BOOTSTRAP_TEXT role=" role))

;; BL-206: bootstrap-text's own dispatch (below) reads only
;; :bootstrap-text-style, never the provider name - registering a new
;; provider under :bootstrap-text-style :generic needs no new text-builder
;; at all; only wording as genuinely novel as aider's needs one of these.
(defn aider-bootstrap-text [role draft coord-note]
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
         "Do not self-schedule polling (/loop, cron, or \"check again in N minutes\").")))

(defn generic-bootstrap-text [role draft two-pack? overlay? overlay-prompt]
  (str "Read swarmforge/constitution.prompt, then read every file it refers to recursively, and obey all of those instructions.\n"
       "Read swarmforge/PIPELINE.md and follow the parcel flow for your role.\n"
       "Read swarmforge/roles/" role ".prompt, then read every file it refers to recursively, and follow all of those instructions.\n"
       (when two-pack?
         (str "Read swarmforge/packs/two-pack.prompt and follow it for this pack.\n"
              "Handoff drafts: write to " draft " then run swarmforge/scripts/swarm_handoff.sh on that file. Never use repo-root tmp/ for drafts (gitignored).\n"))
       (when overlay?
         (str "Read " overlay-prompt " and follow it for this swarm profile.\n"
              (when (not two-pack?)
                (str "Handoff drafts: write to " draft " then run swarmforge/scripts/swarm_handoff.sh on that file. Never use repo-root tmp/ for drafts (gitignored).\n"))))
       (when (and (= role "coordinator") (or two-pack? overlay?))
         "To route the top active backlog item to coder mechanically: swarmforge/scripts/route_backlog_to_coder.sh\n")))

(defn bootstrap-text
  [agent role & {:keys [two-pack? overlay-prompt coordinator-two-pack-note]}]
  (let [draft (handoff-draft-path agent)
        two-pack? (boolean two-pack?)
        overlay? (not (str/blank? overlay-prompt))
        coord-note (or coordinator-two-pack-note
                       (when two-pack?
                         " This pack has no specifier: promote items from backlog/paused into backlog/active (respect active_backlog_max_depth), then send task handoffs directly to coder."))]
    (case (:bootstrap-text-style (capabilities agent))
      :aider (aider-bootstrap-text role draft coord-note)
      :mock (mock-bootstrap-text role)
      (generic-bootstrap-text role draft two-pack? overlay? overlay-prompt))))

(defn needs-tmux-bootstrap?
  [agent]
  (seq (bootstrap-steps agent "coder")))

;; ── BL-206: the remaining lifecycle verbs (health, stop, respawn) ────────
;; wake-steps/bootstrap-steps above are the only two verbs that genuinely
;; vary by provider (different CLIs need different waking/bootstrapping
;; syntax); health/stop/respawn are tmux-pane-level operations - reading a
;; pane's output, killing a pane, or killing-and-relaunching a pane via its
;; own already-persisted launch script - which is identical machinery
;; regardless of what CLI happens to be running inside that pane. Each
;; still takes agent as its first argument for interface parity with
;; wake-steps/bootstrap-steps (and so a provider that ever DOES need
;; genuinely different lifecycle behavior has a capability flag to add
;; without changing any call site), but produces the same step for every
;; supported provider today - no case/cond needed to express that.
(defn health-steps
  "A read-only liveness check: capture the pane and let the caller judge
   liveness/staleness from its content."
  [_agent]
  [{:op :capture-pane}])

(defn stop-steps
  "Terminates the pane."
  [_agent]
  [{:op :kill-pane}])

(defn respawn-steps
  "Kills and relaunches the pane via its own persisted launch script - that
   script (not this library) already encapsulates whatever CLI invocation
   this provider needs, so respawning is the same operation for every one
   of them."
  [_agent]
  [{:op :respawn-pane}])

;; ── BL-207: provider error taxonomy ──────────────────────────────────────
;; Slice 3 of the provider-neutral contract epic, at the same adapter
;; boundary BL-206's capability model lives at. A stable, closed Forge-level
;; error taxonomy so fork orchestration and the extension's own surfacing
;; of errors agree on failure CATEGORY, never brand-specific message text.
;; Mirrors extension/src/swarm/providerErrorTaxonomy.ts's
;; classifyProviderError exactly (same six categories, same keyword
;; patterns) - the same failure text classifies to the same category on
;; both sides. Best-effort keyword classification (exact per-provider
;; wording was not independently confirmed against live docs for every
;; brand while building this, same posture as recertInboundWebhook.ts's
;; extractEmailFields): an unrecognized detail safely falls back to
;; :unknown with the detail attached, never a crash.
(def error-category-patterns
  [[:timeout #"(?i)\btimed?[\s-]?out\b|ETIMEDOUT"]
   [:auth #"(?i)\b(unauthorized|forbidden|invalid api[\s-]?key|invalid[\s\S]*credential|authentication failed|401|403)\b"]
   [:unavailable #"(?i)\b(rate[\s-]?limit|too many requests|overloaded|service unavailable|429|503)\b"]
   [:launch-failed #"(?i)\b(enoent|command not found|no such file|cannot spawn|no launch script|no tmux socket|no .*wrapper found|failed to start)\b"]
   [:protocol #"(?i)\b(unexpected token|json[\s\S]*pars|parse error|malformed|invalid response)\b"]])

(defn classify-provider-error
  "Maps a raw backend failure detail onto one of the closed Forge error
   categories ({:category :detail}). code, if given (e.g. a shell exit
   signal name or errno-like string), is folded into the same text search
   as detail so a structured signal and its equivalent free-text wording
   always agree on category. Falls back to :unknown - detail is never
   discarded, never a crash."
  ([detail] (classify-provider-error detail nil))
  ([detail code]
   (let [haystack (str (or code "") " " (or detail ""))
         match (some (fn [[category pattern]] (when (re-find pattern haystack) category))
                     error-category-patterns)]
     {:category (or match :unknown) :detail detail})))
