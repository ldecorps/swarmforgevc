#!/usr/bin/env bb
;; TDD runner for prompt_engine_lib.bb — BL-546 Slice 1. Pure assertions, no tmux.
;; PromptEngine is the single authority for swarm prompt composition:
;; compose(role, context) -> {:system-prompt :stable-prefix :metadata}, with the
;; BL-519 stable-prefix contract preserved (constitution+PIPELINE inlined,
;; stable-first, byte-identical across roles).
(ns prompt-engine-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "prompt_engine_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def claude-ctx {:agent "claude" :model "test-model" :two-pack? false :overlay-prompt ""})

;; ── compose API shape ───────────────────────────────────────────────────────
(let [result (prompt-engine-lib/compose "coder" claude-ctx)]
  (assert-true "compose returns :system-prompt" (string? (:system-prompt result)))
  (assert-true "compose returns :stable-prefix" (string? (:stable-prefix result)))
  (assert-true "compose returns :metadata map" (map? (:metadata result))))

;; ── metadata echoes the compose request context ─────────────────────────────
(let [md (:metadata (prompt-engine-lib/compose "coder"
                                               {:agent "claude" :model "test-model"
                                                :two-pack? false :overlay-prompt ""
                                                :deterministic? true}))]
  (assert= "metadata :role" "coder" (:role md))
  (assert= "metadata :agent" "claude" (:agent md))
  (assert= "metadata :model" "test-model" (:model md))
  (assert= "metadata :two-pack?" false (:two-pack? md))
  (assert= "metadata :overlay-prompt" "" (:overlay-prompt md))
  (assert= "metadata :deterministic?" true (:deterministic? md))
  (assert= "metadata :bootstrap-text-style for claude" :generic (:bootstrap-text-style md)))

;; ── BL-519 contract: inlined constitution + PIPELINE, stable-first ──────────
(let [text (:system-prompt (prompt-engine-lib/compose "coder" claude-ctx))
      constitution-idx (str/index-of text "# SwarmForge Constitution")
      pipeline-idx (str/index-of text "# Parcel Flow")
      role-idx (str/index-of text "You are the coder.")]
  (assert-true "composed prompt inlines the constitution content" (some? constitution-idx))
  (assert-true "composed prompt inlines the PIPELINE content" (some? pipeline-idx))
  (assert-true "composed prompt inlines the role prompt" (some? role-idx))
  (assert-true "stable content precedes role-specific content"
               (and (< constitution-idx role-idx) (< pipeline-idx role-idx))))

(assert-true "composed prompt does not instruct a runtime Read of the constitution"
             (not (str/includes? (:system-prompt (prompt-engine-lib/compose "coder" claude-ctx))
                                 "Read swarmforge/constitution.prompt, then read every file it refers to recursively")))

;; ── stable prefix: byte-identical across roles, no volatile markers ─────────
(let [coder (prompt-engine-lib/compose "coder" claude-ctx)
      cleaner (prompt-engine-lib/compose "cleaner" claude-ctx)
      prefix-len (count (:stable-prefix coder))]
  (assert= "stable prefix identical across roles" (:stable-prefix coder) (:stable-prefix cleaner))
  (assert= "system prompts share the same leading stable bytes across roles"
           (subs (:system-prompt coder) 0 prefix-len)
           (subs (:system-prompt cleaner) 0 prefix-len)))

(assert-true "no RESUME-ON-START note in the stable chunk"
             (not (str/includes? (:stable-prefix (prompt-engine-lib/compose "coder" claude-ctx))
                                 "RESUME-ON-START")))

;; ── deterministic mode: byte-stable output for identical requests ───────────
(assert= "deterministic compose is byte-stable across identical invocations"
         (prompt-engine-lib/compose "coder" (assoc claude-ctx :deterministic? true))
         (prompt-engine-lib/compose "coder" (assoc claude-ctx :deterministic? true)))

(assert= "deterministic compose is byte-stable with a task injection too"
         (prompt-engine-lib/compose "coder" {:agent "claude" :deterministic? true
                                             :task-injection "Work BL-000: nothing"})
         (prompt-engine-lib/compose "coder" {:agent "claude" :deterministic? true
                                             :task-injection "Work BL-000: nothing"}))

;; ── optional task injection lands after all role/overlay content ────────────
(let [text (:system-prompt (prompt-engine-lib/compose "coder" {:agent "claude"
                                                               :task-injection "Work BL-546: extract PromptEngine"}))
      role-idx (str/index-of text "You are the coder.")
      inject-idx (str/index-of text "Work BL-546: extract PromptEngine")]
  (assert-true "task injection is present" (some? inject-idx))
  (assert-true "task injection follows role content" (< role-idx inject-idx))
  (assert-true "task injection never disturbs the stable prefix"
               (str/starts-with? text (:stable-prefix (prompt-engine-lib/compose "coder" claude-ctx)))))

;; ── pack overlays route through compose exactly like the old path ───────────
(assert-true "two-pack compose includes the two-pack overlay"
             (str/includes? (:system-prompt (prompt-engine-lib/compose "coder" {:agent "claude" :two-pack? true}))
                            "swarm-pack overlay"))

(assert-true "profile overlay compose includes the overlay prompt content"
             (str/includes? (:system-prompt (prompt-engine-lib/compose "coder" {:agent "claude"
                                                                                :overlay-prompt "swarmforge/packs/mono-router.prompt"}))
                            "swarm-profile overlay"))

;; ── text-style dispatch: aider and mock keep their distinct wording ─────────
(let [aider (prompt-engine-lib/compose "coordinator" {:agent "aider" :two-pack? true})]
  (assert= "aider metadata style" :aider (:bootstrap-text-style (:metadata aider)))
  (assert-true "aider coordinator text forbids coding"
               (str/includes? (:system-prompt aider) "ORCHESTRATOR ONLY")))

(let [mock (prompt-engine-lib/compose "coder" {:agent "mock"})]
  (assert= "mock metadata style" :mock (:bootstrap-text-style (:metadata mock)))
  (assert-true "mock text is tagged"
               (str/includes? (:system-prompt mock) "MOCK_BOOTSTRAP_TEXT")))

(assert= "unknown agent normalizes to claude's generic style"
         :generic
         (:bootstrap-text-style (:metadata (prompt-engine-lib/compose "coder" {:agent "unknown-bot"}))))

;; ── compose defaults: empty context is a valid claude/generic request ───────
(assert= "compose with an empty context defaults to the claude generic path"
         (:system-prompt (prompt-engine-lib/compose "coder" {:agent "claude"}))
         (:system-prompt (prompt-engine-lib/compose "coder" {})))

;; ── BL-206 capability model now lives in PromptEngine ───────────────────────
(doseq [agent prompt-engine-lib/supported-agents]
  (assert-true (str "every supported agent has a capabilities entry: " agent)
               (some? (prompt-engine-lib/capabilities agent))))

(let [synthetic-caps (assoc prompt-engine-lib/provider-capabilities
                            "synthetic-provider" {:wake-style :chat-message
                                                  :bootstrap-style :embedded
                                                  :bootstrap-text-style :generic})]
  (with-redefs [prompt-engine-lib/provider-capabilities synthetic-caps
                prompt-engine-lib/supported-agents (conj prompt-engine-lib/supported-agents "synthetic-provider")]
    (assert-true "a synthetic generic-style provider composes through the shared generic path"
                 (str/starts-with? (:system-prompt (prompt-engine-lib/compose "coder" {:agent "synthetic-provider"}))
                                   (:stable-prefix (prompt-engine-lib/compose "coder" claude-ctx))))))

;; ── stable-prefix-text / stable-bootstrap-prefix fns remain available ───────
(assert-true "stable-prefix-text inlines constitution then PIPELINE"
             (and (str/includes? (prompt-engine-lib/stable-prefix-text) "# SwarmForge Constitution")
                  (str/includes? (prompt-engine-lib/stable-prefix-text) "# Parcel Flow")))

(assert= "stable-prefix equals stable-bootstrap-prefix for the generic path"
         (prompt-engine-lib/stable-bootstrap-prefix)
         (:stable-prefix (prompt-engine-lib/compose "coder" claude-ctx)))

;; ── reference/ splits: on-demand only, not inlined at boot ──────────────────
(assert-true "reference engineering-detailed body is not in the stable prefix"
             (not (str/includes? (prompt-engine-lib/stable-prefix-text)
                                 "acquire-events-lock!")))
(assert-true "reference workflow-detailed body is not in the stable prefix"
             (not (str/includes? (prompt-engine-lib/stable-prefix-text)
                                 "7dd4d14e")))
(assert-true "slim engineering.prompt still inlined"
             (str/includes? (prompt-engine-lib/stable-prefix-text) "# Engineering Rules"))
(assert-true "slim workflow.prompt still inlined"
             (str/includes? (prompt-engine-lib/stable-prefix-text) "# Workflow Rules"))
(let [stable-len (count (prompt-engine-lib/stable-prefix-text))]
  (assert-true "stable prefix under 50KB after article splits (< 51200 chars)"
               (< stable-len 51200))
  (println (str "stable-prefix chars: " stable-len)))

;; ── BL-858 invariant 2: headroom is bought by MOVING prose, never by ────────
;; weakening the gate. The two assertions above already pin two SPECIFIC known
;; reference/ files; this generalizes the claim to the property itself -
;; ANY file placed under reference/, regardless of name or content, must never
;; reach the stable prefix, because constitution-text's directory walk
;; (fs/list-dir, non-recursive) structurally excludes every subdirectory, not
;; just the two files above. A scratch file with distinctive marker content
;; (never otherwise present in any article) makes this a real, non-vacuous
;; check rather than a restatement of the two hardcoded assertions - it is
;; planted and removed within this one test, never left behind.
(let [marker "BL858-INVARIANT2-SCRATCH-MARKER-3f9a1c"
      scratch-path (str (fs/path "swarmforge" "constitution" "articles" "reference" "__bl858_invariant2_scratch.md"))]
  (spit scratch-path (str "# scratch\n" marker "\n"))
  (try
    (assert-true "an arbitrary reference/ file's content is never inlined into the stable prefix"
                 (not (str/includes? (prompt-engine-lib/stable-prefix-text) marker)))
    (finally
      (fs/delete-if-exists scratch-path))))

;; The cap value itself must be unchanged, not merely satisfied - a gate that
;; silently raised its threshold to "buy" headroom would still pass the
;; `< stable-len 51200` assertion above for any stable-len under the NEW,
;; weaker number. Reading the literal out of this runner's own source (rather
;; than re-asserting `< 51200` again, which proves nothing a raised constant
;; wouldn't also satisfy) is what makes this a check ON the gate, not a repeat
;; THROUGH it.
(let [own-source (slurp *file*)]
  (assert-true "the enforced cap literal is still 51200, not raised or removed"
               (boolean (re-find #"<\s*stable-len\s+51200\)" own-source))))

;; ── BL-574 Slice 2: named fragment registry ──────────────────────────────────
(assert= "fragment-source-path resolves role to the role prompt file"
         "swarmforge/roles/coder.prompt"
         (prompt-engine-lib/fragment-source-path "role" {:role "coder"}))

(assert= "fragment-source-path resolves pack-overlay to the given overlay path"
         "swarmforge/packs/mono-router.prompt"
         (prompt-engine-lib/fragment-source-path "pack-overlay" {:overlay-prompt "swarmforge/packs/mono-router.prompt"}))

(assert= "fragment-source-path returns nil for pack-overlay with no overlay set"
         nil
         (prompt-engine-lib/fragment-source-path "pack-overlay" {:overlay-prompt ""}))

(assert-true "fragment-content-uncached produces constitution content"
             (str/includes? (prompt-engine-lib/fragment-content-uncached "constitution" {})
                            "# SwarmForge Constitution"))

(assert-true "fragment-content-uncached produces role content for the coder"
             (str/includes? (prompt-engine-lib/fragment-content-uncached "role" {:role "coder"})
                            "You are the coder."))

;; ── BL-574 Slice 2: content-hash fragment cache — hit avoids re-read ────────
(let [read-count (atom 0)
      spy-content-fn (fn [_name _req] (swap! read-count inc) "FRAGMENT_CONTENT_V1")
      cache (atom (prompt-engine-lib/empty-fragment-cache))
      first-read (prompt-engine-lib/read-fragment! cache "role" {:role "coder"} :content-fn spy-content-fn)
      second-read (prompt-engine-lib/read-fragment! cache "role" {:role "coder"} :content-fn spy-content-fn)]
  (assert= "cache miss then hit: content-fn called exactly once across two reads" 1 @read-count)
  (assert= "cache hit returns the same content as the original read" first-read second-read))

;; ── BL-574 Slice 2: explicit invalidation forces a re-read with new content ──
(let [read-count (atom 0)
      versions (atom ["FRAGMENT_CONTENT_V1" "FRAGMENT_CONTENT_V2"])
      spy-content-fn (fn [_name _req]
                       (swap! read-count inc)
                       (let [v (first @versions)]
                         (swap! versions rest)
                         v))
      cache (atom (prompt-engine-lib/empty-fragment-cache))
      warm (prompt-engine-lib/read-fragment! cache "role" {:role "coder"} :content-fn spy-content-fn)
      _ (prompt-engine-lib/read-fragment! cache "role" {:role "coder"} :content-fn spy-content-fn) ;; cache hit, no read
      _ (reset! cache (prompt-engine-lib/invalidate-fragment @cache "role"))
      invalidated (prompt-engine-lib/read-fragment! cache "role" {:role "coder"} :content-fn spy-content-fn)]
  (assert= "warm read is V1" "FRAGMENT_CONTENT_V1" warm)
  (assert= "post-invalidation read is re-read as V2, not the stale cached V1" "FRAGMENT_CONTENT_V2" invalidated)
  (assert= "exactly 2 reads occurred: initial miss + post-invalidation miss (the intervening hit read nothing)" 2 @read-count))

;; ── BL-574 Slice 2: cache-cold/warm/invalidated compose output is byte-identical
;;    (the ticket's declared invariant, spot-checked here; full generated
;;    coverage lives in prompt_engine_fragment_cache_property_runner.bb) ──────
(let [cache (atom (prompt-engine-lib/empty-fragment-cache))
      cold (:system-prompt (prompt-engine-lib/compose "coder" (assoc claude-ctx :fragment-cache cache)))
      warm (:system-prompt (prompt-engine-lib/compose "coder" (assoc claude-ctx :fragment-cache cache)))
      _ (swap! cache prompt-engine-lib/invalidate-fragment "role")
      invalidated (:system-prompt (prompt-engine-lib/compose "coder" (assoc claude-ctx :fragment-cache cache)))]
  (assert= "composed output is byte-identical cold vs warm" cold warm)
  (assert= "composed output is byte-identical warm vs post-invalidation re-read" warm invalidated))

;; ── BL-574 Slice 2: per-model/provider adapter registry ──────────────────────
(assert= "claude has the default generic adapter" "generic" (prompt-engine-lib/select-adapter "claude"))
(assert= "aider has the default aider-editor adapter" "aider-editor" (prompt-engine-lib/select-adapter "aider"))
(assert= "an unregistered provider falls back to generic" "generic" (prompt-engine-lib/select-adapter "totally-unknown-provider"))

(prompt-engine-lib/register-adapter! "bl574-test-provider" "bl574-test-adapter")
(assert= "register-adapter! makes a new provider's adapter selectable" "bl574-test-adapter"
         (prompt-engine-lib/select-adapter "bl574-test-provider"))

(assert= "compose metadata carries the selected adapter id"
         "generic"
         (:adapter-id (:metadata (prompt-engine-lib/compose "coder" claude-ctx))))
(assert= "compose metadata carries aider's adapter id for the aider provider"
         "aider-editor"
         (:adapter-id (:metadata (prompt-engine-lib/compose "coordinator" {:agent "aider" :two-pack? true}))))

;; ── report ──────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
