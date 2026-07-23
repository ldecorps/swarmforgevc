#!/usr/bin/env bb
;; Agent runtime facade — pure strategy (no tmux). Callers use the same
;; operations; agent-specific syntax lives here only.
;;
;; BL-546: prompt COMPOSITION (bootstrap text, stable prefix, the BL-206
;; provider capability model that picks the wording) now lives in
;; prompt_engine_lib.bb — PromptEngine is the single authority for it. This
;; namespace keeps its tmux/lifecycle verbs (wake/bootstrap steps, pane-text
;; parsing, error taxonomy) and DELEGATES the composition surface below so
;; pre-BL-546 callers (cache_warm_lib, the CLI, remote_wakeup_nudge,
;; handoffd, swarm_ensure) keep working unchanged during the migration.
(ns agent-runtime-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "prompt_engine_lib.bb")))

(def constitution-articles-dir-rel prompt-engine-lib/constitution-articles-dir-rel)

(def supported-agents prompt-engine-lib/supported-agents)


(def handoff-draft-rel-path prompt-engine-lib/handoff-draft-rel-path)

(def ready-script-rel-path prompt-engine-lib/ready-script-rel-path)

(def default-wake-chat-message
  "You have new handoff mail. If idle, run ready_for_next.sh.")

(def in-process-resume-chat-message
  "You already have in_process work. Continue the current TASK; do not run ready_for_next.sh again.")

(def in-process-resume-shell-message
  "STOP. You already have in_process handoff work. Do NOT run ready_for_next.sh again.
Open the TASK already shown (or re-read inbox/in_process), execute the PAYLOAD with your tools, implement the TASK_NAME from backlog/active, commit, and git_handoff onward.
USE YOUR TOOLS NOW. Re-printing the task or chatting without edits is failure.")


(defn normalize-agent
  "Unknown agents fall back to claude chat-style wake."
  [agent]
  (prompt-engine-lib/normalize-agent agent))

;; ── BL-206: provider capability model ─────────────────────────────────────
;; Canonical home is now prompt_engine_lib.bb (BL-546 — PromptEngine owns
;; which agent gets which prompt wording); the vars below are compatibility
;; aliases. The discipline is unchanged: every orchestration decision reads a
;; capability flag off the map, never branches on the raw provider name via
;; case/cond (capability-branching-01), and adding a provider is adding one
;; entry there - no existing function's own logic changes
;; (new-provider-is-capabilities-02). NOTE for tests: rebind
;; prompt-engine-lib/provider-capabilities, not this alias — a plain def
;; aliases the VALUE, so with-redefs here does not reach the canonical var.
(def provider-capabilities prompt-engine-lib/provider-capabilities)

(defn capabilities [agent]
  (prompt-engine-lib/capabilities agent))

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

(defn in-process-resume-steps
  "Stuck-nudge for work already in in_process. Always a chat order — never
   re-run ready_for_next (that just reprints the same TASK and feeds the
   aider 'Added N lines' loop). Chat-style agents get a short reminder;
   shell-run-script agents (aider) keep the explicit STOP wording."
  [agent]
  (let [text (case (:wake-style (capabilities agent))
               :mock "MOCK_RESUME_IN_PROCESS"
               :shell-run-script in-process-resume-shell-message
               in-process-resume-chat-message)]
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
  (prompt-engine-lib/mock-bootstrap-text role))

;; ── BL-519 stable-prefix surface (delegates to PromptEngine) ──────────────
;; The BL-519 contract (constitution+PIPELINE inlined as a cacheable,
;; stable-first prefix, byte-identical across roles and packs) is PromptEngine
;; property now; these delegates keep this namespace's pre-BL-546 API intact
;; for cache_warm_lib, the CLI, and tests while callers migrate.
(defn constitution-text [] (prompt-engine-lib/constitution-text))

(defn pipeline-text [] (prompt-engine-lib/pipeline-text))

(defn stable-prefix-text [] (prompt-engine-lib/stable-prefix-text))

(defn stable-bootstrap-prefix [] (prompt-engine-lib/stable-bootstrap-prefix))

;; BL-206: compose's own dispatch (in PromptEngine) reads only
;; :bootstrap-text-style, never the provider name - registering a new
;; provider under :bootstrap-text-style :generic needs no new text-builder
;; at all; only wording as genuinely novel as aider's needs one of these.
(defn aider-bootstrap-text [role draft coord-note]
  (prompt-engine-lib/aider-bootstrap-text role draft coord-note))

(defn generic-bootstrap-text [role draft two-pack? overlay? overlay-prompt]
  (prompt-engine-lib/generic-bootstrap-text role draft two-pack? overlay? overlay-prompt))

(defn bootstrap-text
  "Pre-BL-546 entry point, now a thin delegate: PromptEngine compose owns
   the assembly. New callers should use prompt-engine-lib/compose (or the
   prompt_engine_cli.bb CLI) directly."
  [agent role & {:keys [two-pack? overlay-prompt coordinator-two-pack-note]}]
  (:system-prompt (prompt-engine-lib/compose role {:agent agent
                                                   :two-pack? two-pack?
                                                   :overlay-prompt overlay-prompt
                                                   :coordinator-two-pack-note coordinator-two-pack-note})))

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
