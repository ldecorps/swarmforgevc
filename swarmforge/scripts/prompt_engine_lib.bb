#!/usr/bin/env bb
;; PromptEngine — the single authority for all swarm prompt composition
;; (BL-546 Slice 1: extract and centralise). No swarm agent or launch script
;; assembles prompt text directly; every system-prompt artifact
;; (.swarmforge/prompts/<role>.md) is produced through compose here.
;;
;; Slice 1 scope: today's assembly (constitution+PIPELINE inlined per BL-519,
;; role prompt, pack/profile overlays) extracted from agent_runtime_lib.bb
;; behind one compose API. Model-specific adapters beyond the generic/aider
;; split, fragment catalogues, and versioning/inspection are Slices 2-3.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "prompt_engine_lib.bb")))
;; and referred to as prompt-engine-lib/foo.
(ns prompt-engine-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; ── repo-relative file resolution ──────────────────────────────────────────
;; Resolved from this file's own location (never cwd) so compose works the
;; same regardless of the caller's working directory.
(def ^:private lib-dir (fs/parent (fs/canonicalize *file*)))
(def ^:private repo-root (fs/parent (fs/parent lib-dir)))

(defn- repo-file [rel-path]
  (str (fs/path repo-root rel-path)))

(defn- slurp-repo [rel-path]
  (slurp (repo-file rel-path)))

(def constitution-articles-dir-rel "swarmforge/constitution/articles")

(def handoff-draft-rel-path "swarmforge/runtime/handoff-draft.txt")

(def ready-script-rel-path "swarmforge/scripts/ready_for_next.sh")

;; ── provider capability model (canonical home — BL-206) ────────────────────
;; PromptEngine owns which agent/model gets which prompt wording, so the
;; capability map that decides it lives here. Every orchestration decision
;; reads a capability flag off this map, never branches on the raw provider
;; name via case/cond (capability-branching-01). One entry per
;; supported-agents member. Adding a provider is adding one entry here - no
;; existing function's own logic changes (new-provider-is-capabilities-02);
;; only a provider whose wording is genuinely novel (like aider's) also needs
;; a new text-builder, since capability flags alone can route to prose, not
;; invent it. agent_runtime_lib.bb delegates here for backward compatibility.
(def supported-agents #{"claude" "aider" "grok" "codex" "copilot" "vibe" "gemini" "mock"})

(defn normalize-agent
  "Unknown agents fall back to claude chat-style wake."
  [agent]
  (let [a (some-> agent str/lower-case str/trim)]
    (if (contains? supported-agents a) a "claude")))

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
   ;; Mistral Vibe: a CLI coding agent with bash tools, so it takes the SAME
   ;; shape as claude/copilot — the role prompt is embedded in the launch
   ;; command (positional PROMPT) and it is woken by chatting at it. Do NOT
   ;; model it on aider: aider shares Mistral as a MODEL but is a file editor
   ;; that cannot execute, and that difference is what makes aider unusable as
   ;; a swarm role. Capability entries describe the AGENT, not the model.
   "vibe"    {:wake-style :chat-message
              :bootstrap-style :embedded
              :bootstrap-text-style :generic
              :startup-delay-ms 3000}
   ;; Google Gemini CLI (`gemini`): interactive coding agent with YOLO mode
   ;; (-y). Same wake/bootstrap shape as vibe/codex — prompt path in the
   ;; first message; woken by chatting. Auth via GEMINI_API_KEY (tmux -e).
   "gemini"  {:wake-style :chat-message
              :bootstrap-style :embedded
              :bootstrap-text-style :generic
              :startup-delay-ms 3000}
   "mock"    {:wake-style :mock
              :bootstrap-style :mock
              :bootstrap-text-style :mock}})

(defn capabilities [agent]
  (get provider-capabilities (normalize-agent agent)))

(defn handoff-draft-path
  "Writable by all runtimes (not under .swarmforge/ or repo-root tmp/)."
  [_agent]
  handoff-draft-rel-path)

;; ── BL-519: inline the constitution + PIPELINE as a cacheable, ─────────────
;; stable-first prefix instead of runtime "Read ..." instructions. Every
;; respawn used to pay full input-token price re-reading these files via
;; tool calls; inlining them into the appended system prompt lets Anthropic
;; prompt caching serve repeat respawns from a ~0.1x cache read instead.
;; The prefix takes NO role/pack arguments, so it is byte-identical across
;; every role and every pack built from this same code path (BL-519
;; stable-prefix-byte-identical-across-packs-04) - do not thread role or
;; overlay info into it; that content belongs strictly after it.
(defn- inline-repo-file-or-note
  "Inlines rel-path's content, or a visible placeholder if it does not
   exist. Every external file this namespace inlines (constitution,
   PIPELINE, role prompt, overlay/pack prompt) goes through this same
   degrade-not-crash seam: a real launch always has every file, but a test
   fixture built for an unrelated concern (provider selection, conf
   parsing, ...) often stubs only what ITS OWN assertions touch, and must
   not be forced to maintain a full mirror of unrelated content just
   because bootstrap-text now reads real files instead of emitting inert
   path strings."
  [rel-path]
  (if (fs/exists? (repo-file rel-path))
    (slurp-repo rel-path)
    (str "[[missing file: " rel-path "]]")))

(defn constitution-text
  "swarmforge/constitution.prompt plus every *top-level* article/prompt file in
   swarmforge/constitution/articles/ (sorted), in deterministic order.
   Subdirectories (e.g. articles/reference/) are on-demand only — not inlined
   at boot, to keep the BL-519 stable prefix within context budget."
  []
  (let [articles-dir (repo-file constitution-articles-dir-rel)
        article-paths (if (fs/exists? articles-dir)
                        (->> (fs/list-dir articles-dir)
                             (map str)
                             (filter #(and (fs/regular-file? %)
                                           (not (str/starts-with? (fs/file-name %) "."))))
                             sort)
                        [])]
    (str/join "\n"
              (into [(inline-repo-file-or-note "swarmforge/constitution.prompt")]
                    (map slurp article-paths)))))

(defn pipeline-text []
  (inline-repo-file-or-note "swarmforge/PIPELINE.md"))

(defn stable-prefix-text
  "The cacheable, stable-shared chunk: constitution (recursively expanded)
   then PIPELINE, in that order, ahead of any role-specific content."
  []
  (str (constitution-text) "\n" (pipeline-text)))

(defn stable-bootstrap-prefix
  "The full byte-identical prefix a generic-style compose emits before any
   role-specific content: a constant framing sentence, then stable-prefix-
   text, then the constant framing sentence that introduces the role
   section. Takes no role/pack arguments - every generic-style compose (any
   role, any pack) starts with exactly this text, which is what makes it a
   valid Anthropic prompt-caching prefix."
  []
  (str "The following is your constitution and pipeline. Obey it exactly, as if you had just read it.\n\n"
       (stable-prefix-text)
       "\n\n"
       "The following is your role. Follow it exactly, as if you had just read it.\n\n"))

;; ── text builders (one per :bootstrap-text-style) ──────────────────────────
;; compose's own dispatch (below) reads only :bootstrap-text-style, never the
;; provider name - registering a new provider under :bootstrap-text-style
;; :generic needs no new text-builder at all; only wording as genuinely novel
;; as aider's needs one of these.
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
  (str (stable-bootstrap-prefix)
       (inline-repo-file-or-note (str "swarmforge/roles/" role ".prompt"))
       "\n"
       (when two-pack?
         (str "\nThe following swarm-pack overlay applies to your role. Follow it for this pack.\n\n"
              (inline-repo-file-or-note "swarmforge/packs/two-pack.prompt")
              "\n"
              "Handoff drafts: write to " draft " then run swarmforge/scripts/swarm_handoff.sh on that file. Never use repo-root tmp/ for drafts (gitignored).\n"))
       (when overlay?
         (str "\nThe following swarm-profile overlay applies to your role. Follow it for this swarm profile.\n\n"
              (inline-repo-file-or-note overlay-prompt)
              "\n"
              (when (not two-pack?)
                (str "Handoff drafts: write to " draft " then run swarmforge/scripts/swarm_handoff.sh on that file. Never use repo-root tmp/ for drafts (gitignored).\n"))))
       (when (and (= role "coordinator") (or two-pack? overlay?))
         "\nTo route the top active backlog item to coder mechanically: swarmforge/scripts/route_backlog_to_coder.sh\n")))

(defn mock-bootstrap-text [role]
  (str "MOCK_BOOTSTRAP_TEXT role=" role))

;; ── compose: the single entry point ────────────────────────────────────────
;; compose(role, context) -> {:system-prompt :stable-prefix :metadata}.
;; context keys (all optional unless noted):
;;   :agent            provider key (default "claude"; normalized via
;;                     normalize-agent, unknown -> claude)
;;   :model            model id - metadata only in Slice 1 (adapters are
;;                     Slice 2); echoed so callers/inspectors can see it
;;   :two-pack?        include the two-pack swarm-pack overlay
;;   :overlay-prompt   repo-relative path to a swarm-profile overlay prompt
;;   :task-injection   optional task text appended AFTER all role/overlay
;;                     content - never before or inside the stable chunk
;;   :coordinator-two-pack-note   overrides the coordinator two-pack note
;;                                (agent_runtime_lib compat)
;;   :deterministic?   contract flag: output is byte-stable for identical
;;                     inputs (no timestamps/session ids anywhere in the
;;                     composed text). Slice 1's composition is already
;;                     volatile-free, so this documents and pins the
;;                     property rather than changing behavior.
;; The BL-519 stable prefix is returned as :stable-prefix so callers (cache
;; warm, byte-identity checks) never re-derive it by string surgery.
(defn compose
  [role {:keys [agent model two-pack? overlay-prompt task-injection
                coordinator-two-pack-note deterministic?]
         :or {agent "claude" overlay-prompt ""}}]
  (let [normalized (normalize-agent agent)
        style (:bootstrap-text-style (capabilities normalized))
        draft (handoff-draft-path normalized)
        two-pack? (boolean two-pack?)
        overlay? (not (str/blank? overlay-prompt))
        coord-note (or coordinator-two-pack-note
                       (when two-pack?
                         " This pack has no specifier: promote items from backlog/paused into backlog/active (respect active_backlog_max_depth), then send task handoffs directly to coder."))
        body (case style
               :aider (aider-bootstrap-text role draft coord-note)
               :mock (mock-bootstrap-text role)
               (generic-bootstrap-text role draft two-pack? overlay? overlay-prompt))
        system-prompt (if (str/blank? task-injection)
                        body
                        (str body "\n" task-injection "\n"))]
    {:system-prompt system-prompt
     :stable-prefix (stable-bootstrap-prefix)
     :metadata {:role role
                :agent normalized
                :model model
                :two-pack? two-pack?
                :overlay-prompt overlay-prompt
                :deterministic? (boolean deterministic?)
                :bootstrap-text-style style}}))
