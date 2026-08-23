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
            [clojure.string :as str])
  (:import [java.security MessageDigest]))

;; ── repo-relative file resolution ──────────────────────────────────────────
;; Resolved from this file's own location (never cwd) so compose works the
;; same regardless of the caller's working directory.
(def ^:private lib-dir (fs/parent (fs/canonicalize *file*)))
(def ^:private repo-root (fs/parent (fs/parent lib-dir)))

(defn- repo-file
  ([rel-path] (repo-file repo-root rel-path))
  ([root rel-path] (str (fs/path root rel-path))))

(defn- slurp-repo
  ([rel-path] (slurp-repo repo-root rel-path))
  ([root rel-path] (slurp (repo-file root rel-path))))

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
  ([rel-path] (inline-repo-file-or-note repo-root rel-path))
  ([root rel-path]
   (if (fs/exists? (repo-file root rel-path))
     (slurp-repo root rel-path)
     (str "[[missing file: " rel-path "]]"))))

(defn constitution-text
  "swarmforge/constitution.prompt plus every *top-level* article/prompt file in
   swarmforge/constitution/articles/ (sorted), in deterministic order.
   Subdirectories (e.g. articles/reference/) are on-demand only — not inlined
   at boot, to keep the BL-519 stable prefix within context budget.
   root, when given, reads this same shape from a different tree instead of
   the real repo (BL-859: lets the boot-prefix budget gate measure a
   synthetic tree through this exact composer, not a re-derived copy)."
  ([] (constitution-text repo-root))
  ([root]
   (let [articles-dir (repo-file root constitution-articles-dir-rel)
         article-paths (if (fs/exists? articles-dir)
                         (->> (fs/list-dir articles-dir)
                              (map str)
                              (filter #(and (fs/regular-file? %)
                                            (not (str/starts-with? (fs/file-name %) "."))))
                              sort)
                         [])]
     (str/join "\n"
               (into [(inline-repo-file-or-note root "swarmforge/constitution.prompt")]
                     (map slurp article-paths))))))

(defn pipeline-text
  ([] (pipeline-text repo-root))
  ([root] (inline-repo-file-or-note root "swarmforge/PIPELINE.md")))

;; ── BL-574 Slice 2: named fragment registry + content-hash cache ───────────
;; Fragments are composed BY REFERENCE: editing a fragment file changes the
;; composed prompt with no edit to compose logic. "constitution"/"pipeline"
;; are request-independent aggregates (constitution-text/pipeline-text
;; above); "role"/"pack-overlay" are single files resolved per request;
;; "tool-instructions" is registered as a known name with no content source
;; yet (Slice 3 / not part of today's compose output).
(def fragment-names
  #{"constitution" "pipeline" "role" "pack-overlay" "tool-instructions"})

(defn fragment-source-path
  "Repo-relative source path for a per-request fragment, or nil when the
   fragment has no applicable source for THIS request (e.g. \"pack-overlay\"
   with no overlay set). \"constitution\"/\"pipeline\" have no single path -
   see fragment-content-uncached, which produces their content directly."
  [fragment-name {:keys [role overlay-prompt]}]
  (case fragment-name
    "role" (when-not (str/blank? role) (str "swarmforge/roles/" role ".prompt"))
    "pack-overlay" (when-not (str/blank? overlay-prompt) overlay-prompt)
    nil))

(defn fragment-content-uncached
  "The one place that knows how to PRODUCE each named fragment's content,
   always reading from disk with no cache involvement - the default
   content-fn every cache miss falls back to. request carries whatever the
   fragment needs to resolve (:role, :overlay-prompt)."
  [fragment-name request]
  (case fragment-name
    "constitution" (constitution-text)
    "pipeline" (pipeline-text)
    "tool-instructions" nil
    (some-> (fragment-source-path fragment-name request) inline-repo-file-or-note)))

(defn empty-fragment-cache [] {})

(defn sha256-hex [s]
  (let [digest (-> (MessageDigest/getInstance "SHA-256")
                    (.digest (.getBytes (or s "") "UTF-8")))]
    (apply str (map #(format "%02x" %) digest))))

(defn read-fragment
  "Pure cache lookup+populate: returns [content cache' read?]. content-fn is
   the injectable IO seam (default fragment-content-uncached) - a test
   passes a call-counting stub with no real filesystem involved, per this
   project's \"decision logic pure and unit-testable with no filesystem\"
   rule; the CLI/compose caller is the edge that supplies the real one.
   Cache is a plain {fragment-name -> {:hash :content}} map threaded
   explicitly by the caller across composes - no hidden global mutable
   state. A cache hit never calls content-fn at all (the literal meaning of
   \"not re-read\"); on a miss the freshly produced content is hashed and
   stored under fragment-name so the NEXT lookup with this same cache value
   hits without re-reading."
  [cache fragment-name request & {:keys [content-fn] :or {content-fn fragment-content-uncached}}]
  (if-let [cached (get cache fragment-name)]
    [(:content cached) cache false]
    (let [content (content-fn fragment-name request)
          hash (sha256-hex (or content ""))]
      [content (assoc cache fragment-name {:hash hash :content content}) true])))

(defn read-fragment!
  "Impure convenience over read-fragment for a single-threaded caller
   (compose): mutates cache-atom in place, returns just the content."
  [cache-atom fragment-name request & {:keys [content-fn] :or {content-fn fragment-content-uncached}}]
  (let [[content cache' _read?] (read-fragment @cache-atom fragment-name request :content-fn content-fn)]
    (reset! cache-atom cache')
    content))

(defn invalidate-fragment
  "Explicit eviction - the caller's signal that a fragment's source changed
   on disk. Content-hash caching here has no automatic invalidation: mtime
   is unusable as any part of the decision (BL-373's worktree hot-sync
   touches mtime independent of content, which would make a mtime-gated
   cache miss on every compose in this environment - the opposite of the
   goal). A fragment stays cached until something that knows it changed
   says so."
  [cache fragment-name]
  (dissoc cache fragment-name))

;; ── BL-574 Slice 2: per-model/provider adapter registry ────────────────────
;; Registry-driven (BL-206): adding a provider's adapter is one
;; register-adapter! call: compose's own dispatch (below) never branches on
;; provider name to select an adapter id. Distinct from provider-
;; capabilities/:bootstrap-text-style above (Slice 1's wake/bootstrap
;; mechanics, a fixed 3-value enum every provider maps into) - this registry
;; is Model Steward's (BL-547) forward-looking home for adapter metadata
;; PromptEngine loads by key; today it only feeds compose's :adapter-id
;; metadata, not yet distinct wording (Slice 3 territory).
(def default-adapter-registry
  {"claude" "generic"
   "codex" "generic"
   "copilot" "generic"
   "grok" "generic"
   "vibe" "generic"
   "gemini" "generic"
   "mock" "generic"
   "aider" "aider-editor"})

(defonce ^:private adapter-registry-atom (atom default-adapter-registry))

(defn register-adapter!
  "Registers (or overrides) the adapter id for a provider."
  [provider adapter-id]
  (swap! adapter-registry-atom assoc provider adapter-id))

(defn select-adapter
  "Adapter id for a provider, defaulting to \"generic\" for a provider with
   no registered adapter. model is accepted for a future per-model override
   (Slice 2 keys off provider only) so this function's callers do not need
   to change when that lands."
  [provider & {:keys [model]}]
  (get @adapter-registry-atom provider "generic"))

(defn stable-prefix-text
  "The cacheable, stable-shared chunk: constitution (recursively expanded)
   then PIPELINE, in that order, ahead of any role-specific content. root,
   when given, composes this same shape from a synthetic tree (BL-859)."
  ([] (stable-prefix-text repo-root))
  ([root] (str (constitution-text root) "\n" (pipeline-text root))))

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

(defn generic-bootstrap-text
  "fragment-cache-atom/content-fn (BL-574 Slice 2): the role and pack-overlay
   fragments - the two per-request single-file reads - go through the
   content-hash cache instead of a direct slurp, so a caller composing
   repeatedly against the SAME cache-atom does not re-read an unchanged
   fragment. constitution/pipeline stay on stable-bootstrap-prefix's direct
   path (already one aggregated, request-independent read)."
  [role draft two-pack? overlay? overlay-prompt fragment-cache-atom content-fn]
  (str (stable-bootstrap-prefix)
       (read-fragment! fragment-cache-atom "role" {:role role} :content-fn content-fn)
       "\n"
       (when two-pack?
         (str "\nThe following swarm-pack overlay applies to your role. Follow it for this pack.\n\n"
              (inline-repo-file-or-note "swarmforge/packs/two-pack.prompt")
              "\n"
              "Handoff drafts: write to " draft " then run swarmforge/scripts/swarm_handoff.sh on that file. Never use repo-root tmp/ for drafts (gitignored).\n"))
       (when overlay?
         (str "\nThe following swarm-profile overlay applies to your role. Follow it for this swarm profile.\n\n"
              (read-fragment! fragment-cache-atom "pack-overlay" {:overlay-prompt overlay-prompt} :content-fn content-fn)
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
;;   :model            model id - metadata only in Slice 1; Slice 2 also
;;                     accepts it in select-adapter's signature (unused for
;;                     selection today - adapters key off provider - so
;;                     compose's :adapter-id metadata is stable either way)
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
;;   :fragment-cache   (BL-574 Slice 2) an atom holding a fragment cache
;;                     value (empty-fragment-cache shape) threaded across
;;                     repeat compose calls by a caller that wants the
;;                     content-hash cache's benefit. Defaults to a fresh
;;                     atom per call, which behaves exactly like no caching
;;                     at all - existing callers are unaffected.
;;   :fragment-content-fn   (BL-574 Slice 2) injectable IO seam for cache
;;                     misses, default fragment-content-uncached (real
;;                     file reads). Tests inject a call-counting stub.
;; The BL-519 stable prefix is returned as :stable-prefix so callers (cache
;; warm, byte-identity checks) never re-derive it by string surgery.
(defn compose
  [role {:keys [agent model two-pack? overlay-prompt task-injection
                coordinator-two-pack-note deterministic?
                fragment-cache fragment-content-fn]
         :or {agent "claude" overlay-prompt "" fragment-content-fn fragment-content-uncached}}]
  (let [normalized (normalize-agent agent)
        style (:bootstrap-text-style (capabilities normalized))
        draft (handoff-draft-path normalized)
        two-pack? (boolean two-pack?)
        overlay? (not (str/blank? overlay-prompt))
        fragment-cache-atom (or fragment-cache (atom (empty-fragment-cache)))
        adapter-id (select-adapter normalized :model model)
        coord-note (or coordinator-two-pack-note
                       (when two-pack?
                         " This pack has no specifier: promote items from backlog/paused into backlog/active (respect active_backlog_max_depth), then send task handoffs directly to coder."))
        body (case style
               :aider (aider-bootstrap-text role draft coord-note)
               :mock (mock-bootstrap-text role)
               (generic-bootstrap-text role draft two-pack? overlay? overlay-prompt
                                       fragment-cache-atom fragment-content-fn))
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
                :bootstrap-text-style style
                :adapter-id adapter-id}}))
