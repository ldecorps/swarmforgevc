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

;; ── BL-859: constitution-text/pipeline-text/stable-prefix-text take an ─────
;; optional tree-root argument, reading that same composed shape from a
;; synthetic tree instead of the real repo. This is what lets the boot-prefix
;; budget gate measure a synthetic tree THROUGH this exact composer (never a
;; second implementation that can drift from it) without mutating the real
;; constitution tree - the injected-root testability invariant BL-859 declares.
(let [d (str (fs/create-temp-dir {:prefix "prompt-engine-root-arg-test-"}))]
  (try
    (fs/create-dirs (fs/path d "swarmforge" "constitution" "articles" "reference"))
    (spit (str (fs/path d "swarmforge" "constitution.prompt")) "SYNTHETIC-ROOT-MARKER-CONST")
    (spit (str (fs/path d "swarmforge" "constitution" "articles" "01_a.md")) "SYNTHETIC-ROOT-MARKER-ARTICLE")
    (spit (str (fs/path d "swarmforge" "constitution" "articles" "reference" "deep.md")) "SYNTHETIC-ROOT-MARKER-REFERENCE")
    (spit (str (fs/path d "swarmforge" "PIPELINE.md")) "SYNTHETIC-ROOT-MARKER-PIPELINE")

    (assert-true "constitution-text with an explicit root reads that tree, not the real repo"
                 (str/includes? (prompt-engine-lib/constitution-text d) "SYNTHETIC-ROOT-MARKER-ARTICLE"))
    (assert-true "constitution-text with an explicit root does not see the real repo's constitution"
                 (not (str/includes? (prompt-engine-lib/constitution-text d) "# SwarmForge Constitution")))
    (assert-true "pipeline-text with an explicit root reads that tree's PIPELINE.md"
                 (str/includes? (prompt-engine-lib/pipeline-text d) "SYNTHETIC-ROOT-MARKER-PIPELINE"))
    (assert-true "stable-prefix-text with an explicit root composes constitution then pipeline from that tree"
                 (let [t (prompt-engine-lib/stable-prefix-text d)]
                   (and (str/includes? t "SYNTHETIC-ROOT-MARKER-CONST")
                        (str/includes? t "SYNTHETIC-ROOT-MARKER-ARTICLE")
                        (str/includes? t "SYNTHETIC-ROOT-MARKER-PIPELINE"))))
    (assert-true "stable-prefix-text with an explicit root still excludes reference/ bodies"
                 (not (str/includes? (prompt-engine-lib/stable-prefix-text d) "SYNTHETIC-ROOT-MARKER-REFERENCE")))
    (assert-true "the real repo's own stable-prefix-text is unaffected by the synthetic tree existing on disk"
                 (str/includes? (prompt-engine-lib/stable-prefix-text) "# SwarmForge Constitution"))
    (finally
      (fs/delete-tree d))))

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

;; ── BL-1798: :local-compact style - a local-model seat's compact card ──────

(assert= "fragment-source-path resolves the shared loop-card path"
         "swarmforge/roles/local-model/loop.note"
         (prompt-engine-lib/fragment-source-path "local-loop" {}))
(assert= "fragment-source-path resolves a role's own card path"
         "swarmforge/roles/local-model/coder.note"
         (prompt-engine-lib/fragment-source-path "local-role-card" {:role "coder"}))
(assert= "fragment-source-path resolves no role-card path for a blank role"
         nil
         (prompt-engine-lib/fragment-source-path "local-role-card" {:role ""}))
(assert-true "local-loop and local-role-card are registered fragment names"
             (and (contains? prompt-engine-lib/fragment-names "local-loop")
                  (contains? prompt-engine-lib/fragment-names "local-role-card")))

(assert= "local-model-role-card-path matches fragment-source-path"
         (prompt-engine-lib/fragment-source-path "local-role-card" {:role "coder"})
         (prompt-engine-lib/local-model-role-card-path "coder"))

;; local-model-has-role-card? is a real filesystem check (this ticket's own
;; two shipped notes vs a role with none) - real files, not a stub, are the
;; correct fixture here: the predicate's whole job is "does this exact repo
;; path exist", which a stub cannot meaningfully fake without re-deriving
;; the same path logic under test.
(assert-true "local-model-has-role-card? is true for coder (this ticket ships its card)"
             (prompt-engine-lib/local-model-has-role-card? "coder"))
(assert-true "local-model-has-role-card? is false for a role with no card (operator)"
             (not (prompt-engine-lib/local-model-has-role-card? "operator")))
(assert-true "local-model-has-role-card? is false for a blank role"
             (not (prompt-engine-lib/local-model-has-role-card? "")))

;; local-compact-bootstrap-text itself, over STUBBED fragment content (never
;; the real note files) - isolates the function's own shape (loop then role
;; card, one-line overlay pointers) from what the notes happen to say today.
(let [stub-fn (fn [name _req]
                (case name
                  "local-loop" "LOOP_CARD_V1"
                  "local-role-card" "ROLE_CARD_V1"
                  nil))
      cache (atom (prompt-engine-lib/empty-fragment-cache))]
  (assert= "local-compact-bootstrap-text: loop card then role card, no pack/overlay"
           "LOOP_CARD_V1\nROLE_CARD_V1"
           (prompt-engine-lib/local-compact-bootstrap-text "coder" false false "" cache stub-fn))
  (assert-true "local-compact-bootstrap-text: two-pack appears as a one-line pointer, never inlined"
               (let [text (prompt-engine-lib/local-compact-bootstrap-text "coder" true false "" cache stub-fn)]
                 (and (str/includes? text "swarmforge/packs/two-pack.prompt")
                      ;; the real file's own heading - present only if inlined, never in a one-line pointer
                      (not (str/includes? text "# Two-pack overlay")))))
  (assert-true "local-compact-bootstrap-text: overlay appears as a one-line pointer naming its path, never inlined"
               (let [text (prompt-engine-lib/local-compact-bootstrap-text
                           "coder" false true "swarmforge/packs/mono-router.prompt" cache stub-fn)]
                 (and (str/includes? text "swarmforge/packs/mono-router.prompt")
                      ;; the real file's own heading - present only if inlined, never in a one-line pointer
                      (not (str/includes? text "one resident agent, a model tailored to each stage"))))))

;; compose dispatch, real files: local-model/coder gets the real compact card.
(let [result (prompt-engine-lib/compose "coder" {:agent "local-model"})]
  (assert= "compose metadata style for local-model/coder" :local-compact (:bootstrap-text-style (:metadata result)))
  (assert-true "local-model/coder composed text is at most 8192 characters"
               (<= (count (:system-prompt result)) 8192))
  (assert-true "local-model/coder composed text names the loop script trio"
               (every? #(str/includes? (:system-prompt result) %)
                       ["ready_for_next.sh" "done_with_current.sh" "swarm_handoff.sh"]))
  (assert-true "local-model/coder composed text points at the full role prompt and constitution"
               (and (str/includes? (:system-prompt result) "swarmforge/roles/coder.prompt")
                    (str/includes? (:system-prompt result) "swarmforge/constitution.prompt")))
  (assert-true "local-model/coder composed text never inlines the generic stable prefix"
               (not (str/includes? (:system-prompt result) "# SwarmForge Constitution"))))

;; Local-model QA card tracks BL-1872: queue the lander, never tip-push main.
;; Catches the card drifting back to the pre-lander "land yourself" path while
;; QA.prompt still says lander_queue.bb (2026-10-07 iq3 self-push incident).
(let [result (prompt-engine-lib/compose "QA" {:agent "local-model"})
      text (:system-prompt result)]
  (assert-true "local-model/QA composed text is at most 8192 characters"
               (<= (count text) 8192))
  (assert-true "local-model/QA card names lander_queue.bb (BL-1872)"
               (str/includes? text "lander_queue.bb"))
  (assert-true "local-model/QA lander_queue root is master checkout not worktree"
               (and (str/includes? text "master-root")
                    (str/includes? text "git-common-dir")
                    (str/includes? text ".worktrees/QA")))
  (assert-true "local-model/QA card does not tell the seat to land on main itself"
               (not (str/includes? text "Land the approved commit on"))))

;; compose dispatch: a role with no card falls back to EXACTLY today's
;; generic composition - never a truncated or partial mix (invariant 2).
(assert= "local-model/operator (no card) equals claude/operator (generic) byte-for-byte"
         (:system-prompt (prompt-engine-lib/compose "operator" {:agent "claude"}))
         (:system-prompt (prompt-engine-lib/compose "operator" {:agent "local-model"})))
(assert= "local-model/operator metadata style is still :local-compact (the AGENT's style; the ROLE has no card)"
         :local-compact
         (:bootstrap-text-style (:metadata (prompt-engine-lib/compose "operator" {:agent "local-model"}))))

;; invariant 1: every OTHER agent's own style and composed text are exactly
;; what they were before this ticket - only local-model's capabilities entry
;; changed, so this is a direct capabilities-table assertion plus a text
;; spot-check per agent.
(doseq [[agent expected-style] [["claude" :generic] ["codex" :generic] ["gemini" :generic]
                                 ["cursor" :generic] ["copilot" :generic] ["vibe" :generic]
                                 ["grok" :generic] ["aider" :aider] ["mock" :mock]]]
  (assert= (str "capabilities style unchanged for " agent)
           expected-style
           (:bootstrap-text-style (prompt-engine-lib/capabilities agent))))
;; BL-1844: derive the expected text from the generic path's OWN files as
;; they are now, never a pinned length - the check still fails whenever a
;; non-local-model agent's composed coder prompt diverges from the generic
;; composition (BL-1798 invariant 1), but passes after an ordinary edit to
;; the constitution, PIPELINE.md or coder.prompt.
(let [expected (prompt-engine-lib/generic-bootstrap-text
                "coder" (prompt-engine-lib/handoff-draft-path "claude") false false ""
                (atom (prompt-engine-lib/empty-fragment-cache)) prompt-engine-lib/fragment-content-uncached)]
  (assert= "claude/coder composed text equals the generic composition of today's files (BL-1798 invariant 1)"
           expected
           (:system-prompt (prompt-engine-lib/compose "coder" {:agent "claude"}))))

;; BL-574 Slice 2: local-loop/local-role-card go through the SAME
;; content-hash cache as "role" - a cache hit never re-reads.
(let [read-count (atom 0)
      spy-fn (fn [name _req] (swap! read-count inc) (str "CONTENT-" name))
      cache (atom (prompt-engine-lib/empty-fragment-cache))
      first-read (prompt-engine-lib/read-fragment! cache "local-role-card" {:role "coder"} :content-fn spy-fn)
      second-read (prompt-engine-lib/read-fragment! cache "local-role-card" {:role "coder"} :content-fn spy-fn)]
  (assert= "local-role-card cache miss then hit: content-fn called exactly once" 1 @read-count)
  (assert= "local-role-card cache hit returns the same content as the original read" first-read second-read))

;; ── BL-1816: knowledge-brief pointer for a local-model seat ─────────────────
;; fragment-content-uncached's "knowledge-brief-payload" branch is exercised
;; here against a REAL mkdtemp :target-root with no payload.json on disk at
;; all (never a stub) - the file-absence guard is its own code path,
;; distinct from a stubbed/blank/malformed payload STRING (covered above),
;; and item 3's "an absent one" names exactly this case.
(def ^:private bl1816-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @bl1816-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))
(defn- bl1816-temp-root []
  (let [d (str (fs/create-temp-dir {:prefix "bl1816-no-payload-"}))]
    (swap! bl1816-temp-dirs conj d)
    d))

(let [root (bl1816-temp-root)]
  (fs/create-dirs (fs/path root ".swarmforge" "agent-memory" "coder"))
  (spit (str (fs/path root ".swarmforge" "agent-memory" "coder" "brief.md")) "# fixture brief\n")
  (assert-true "fragment-content-uncached: knowledge-brief-payload is nil when payload.json is absent from disk"
               (nil? (prompt-engine-lib/fragment-content-uncached
                      "knowledge-brief-payload" {:role "coder" :target-root root})))
  (assert-true "compose local-model over a real fixture with no payload.json appends no pointer"
               (not (str/includes?
                     (:system-prompt (prompt-engine-lib/compose "coder" {:agent "local-model" :target-root root
                                                                          :now-ms 1790000000000}))
                     ".swarmforge/agent-memory/coder/brief.md"))))

(assert= "agent-memory-payload-rel-path for coder"
         ".swarmforge/agent-memory/coder/payload.json"
         (prompt-engine-lib/agent-memory-payload-rel-path "coder"))
(assert= "agent-memory-brief-rel-path for coder"
         ".swarmforge/agent-memory/coder/brief.md"
         (prompt-engine-lib/agent-memory-brief-rel-path "coder"))

(defn- iso-ms [ms] (str (java.time.Instant/ofEpochMilli ms)))
(defn- payload-str [captured-at-ms]
  (str "{\"handoffPack\":{\"capturedAt\":\"" (iso-ms captured-at-ms) "\"}}"))

(let [now 1790000000000]
  (assert-true "knowledge-brief-payload-fresh? true at exactly 2 hours old"
               (prompt-engine-lib/knowledge-brief-payload-fresh?
                (payload-str (- now (* 2 3600000))) now))
  (assert-true "knowledge-brief-payload-fresh? true at exactly the 24h boundary"
               (prompt-engine-lib/knowledge-brief-payload-fresh?
                (payload-str (- now prompt-engine-lib/knowledge-brief-freshness-window-ms)) now))
  (assert-true "knowledge-brief-payload-fresh? false one ms past the 24h boundary"
               (not (prompt-engine-lib/knowledge-brief-payload-fresh?
                     (payload-str (- now prompt-engine-lib/knowledge-brief-freshness-window-ms 1)) now)))
  (assert-true "knowledge-brief-payload-fresh? false at 25 hours old"
               (not (prompt-engine-lib/knowledge-brief-payload-fresh?
                     (payload-str (- now (* 25 3600000))) now)))
  (assert-true "knowledge-brief-payload-fresh? false for nil payload"
               (not (prompt-engine-lib/knowledge-brief-payload-fresh? nil now)))
  (assert-true "knowledge-brief-payload-fresh? false for blank payload"
               (not (prompt-engine-lib/knowledge-brief-payload-fresh? "" now)))
  (assert-true "knowledge-brief-payload-fresh? false for unparseable JSON"
               (not (prompt-engine-lib/knowledge-brief-payload-fresh? "not json" now)))
  (assert-true "knowledge-brief-payload-fresh? false with no capturedAt"
               (not (prompt-engine-lib/knowledge-brief-payload-fresh? "{\"handoffPack\":{}}" now)))
  (assert-true "knowledge-brief-payload-fresh? false with an unparseable capturedAt"
               (not (prompt-engine-lib/knowledge-brief-payload-fresh?
                     "{\"handoffPack\":{\"capturedAt\":\"not-a-date\"}}" now))))

(let [now 1790000000000
      fresh (payload-str (- now (* 2 3600000)))
      stale (payload-str (- now (* 25 3600000)))]
  (assert-true "knowledge-brief-pointer nil when stale"
               (nil? (prompt-engine-lib/knowledge-brief-pointer "coder" now stale "/fixture/root")))
  (assert-true "knowledge-brief-pointer nil when payload absent"
               (nil? (prompt-engine-lib/knowledge-brief-pointer "coder" now nil "/fixture/root")))
  (let [pointer (prompt-engine-lib/knowledge-brief-pointer "coder" now fresh "/fixture/root")]
    (assert-true "knowledge-brief-pointer non-nil when fresh" (some? pointer))
    (assert-true "knowledge-brief-pointer names the brief file"
                 (str/includes? pointer ".swarmforge/agent-memory/coder/brief.md"))
    (assert-true "knowledge-brief-pointer names the brief under the given target-root, not a bare relative path (BL-1816 D1)"
                 (str/includes? pointer "/fixture/root/.swarmforge/agent-memory/coder/brief.md"))
    (assert-true "knowledge-brief-pointer names ready_for_next.sh"
                 (str/includes? pointer "ready_for_next.sh"))
    (assert-true "knowledge-brief-pointer is exactly one line"
                 (= 1 (count (remove str/blank? (str/split-lines pointer)))))))

;; BL-1816 D1 (QA bounce round 2, evidence BL-1816-QA-20260930.md): the
;; pointer must name a path that resolves correctly regardless of the
;; calling process's cwd - the shape of a worktree-resident local seat
;; (coder@iq3 at .worktrees/coder-iq3, while compose read the payload from
;; the master checkout target-root). An absolute path (built via
;; (fs/path target-root ...)) resolves the same from any cwd; the old bare
;; repo-relative path did not, and this is the fixture that would have
;; failed against it (named-path was not absolute, and did not start with
;; root).
(let [root (bl1816-temp-root)
      now 1790000000000
      fresh (payload-str (- now (* 2 3600000)))]
  (fs/create-dirs (fs/path root ".swarmforge" "agent-memory" "coder"))
  (spit (str (fs/path root ".swarmforge" "agent-memory" "coder" "brief.md")) "# fixture brief\n")
  (let [pointer (prompt-engine-lib/knowledge-brief-pointer "coder" now fresh root)
        named-path (second (re-find #"knowledge brief at (.+)\.\n" pointer))]
    (assert-true "BL-1816 D1: the named brief path is absolute (resolves the same from any cwd)"
                 (fs/absolute? named-path))
    (assert-true "BL-1816 D1: the named path names the real file on disk, independent of the test runner's own cwd"
                 (fs/exists? named-path))
    (assert-true "BL-1816 D1: the named path is rooted at target-root, not the repo checkout the runner executes from"
                 (str/starts-with? named-path root))))

;; compose dispatch: the pointer is appended for local-model when the
;; knowledge-brief-payload fragment resolves fresh, and the fragment request
;; carries the :target-root compose itself was given (BL-1816 items 1, 4).
(let [now 1790000000000
      fresh (payload-str (- now (* 2 3600000)))
      seen-requests (atom [])
      stub-fn (fn [name req]
                (swap! seen-requests conj [name req])
                (case name
                  "local-loop" "LOOP_CARD_V1"
                  "local-role-card" "ROLE_CARD_V1"
                  "knowledge-brief-payload" fresh
                  nil))
      result (prompt-engine-lib/compose "coder" {:agent "local-model" :target-root "/fixture/root"
                                                  :now-ms now :fragment-content-fn stub-fn})]
  (assert-true "compose local-model appends the pointer when the stubbed payload is fresh"
               (str/includes? (:system-prompt result) "ready_for_next.sh"))
  (assert-true "compose local-model's knowledge-brief-payload request carries the given :target-root"
               (some (fn [[name req]] (and (= name "knowledge-brief-payload") (= (:target-root req) "/fixture/root")))
                     @seen-requests))
  ;; Position, not just presence: the base compact card comes FIRST, the
  ;; pointer is appended AFTER it (a hand-mutation swapping the append order
  ;; - (str pointer "\n" base) instead of (str base "\n" pointer) - changes
  ;; the composed prompt's observable content but survives every other
  ;; assertion here and the acceptance feature, since both only check for
  ;; substring presence, never position). Computes the expected pointer via
  ;; the same knowledge-brief-pointer the compose dispatch itself calls, so
  ;; this stays pinned to real content, not a hand-copied string.
  (assert= "compose local-model appends the pointer AFTER the base card, never before it"
           (str "LOOP_CARD_V1\nROLE_CARD_V1" "\n" (prompt-engine-lib/knowledge-brief-pointer "coder" now fresh "/fixture/root"))
           (:system-prompt result)))

;; compose dispatch: no pointer when the stub reports no payload (item 3) -
;; the base compact card comes through unchanged, with no trailing blank line.
(let [stub-fn (fn [name _req]
                (case name
                  "local-loop" "LOOP_CARD_V1"
                  "local-role-card" "ROLE_CARD_V1"
                  "knowledge-brief-payload" nil
                  nil))
      result (prompt-engine-lib/compose "coder" {:agent "local-model" :fragment-content-fn stub-fn})]
  (assert= "compose local-model with no payload composes exactly the base compact card"
           "LOOP_CARD_V1\nROLE_CARD_V1"
           (:system-prompt result)))

;; invariant 4: a non-local-model agent's compose never even READS the
;; knowledge-brief-payload fragment - not merely "composes the same text".
(let [read-names (atom #{})
      stub-fn (fn [name _req] (swap! read-names conj name) (str "STUB-" name))
      result (prompt-engine-lib/compose "coder" {:agent "claude" :fragment-content-fn stub-fn})]
  (assert-true "compose returns text for claude/coder with the stub installed" (string? (:system-prompt result)))
  (assert-true "claude/coder compose never reads the knowledge-brief-payload fragment"
               (not (contains? @read-names "knowledge-brief-payload"))))

;; BL-1844 D1: a standing self-check, not a one-off hand grep - every
;; `(count (:system-prompt ...))` in THIS file's own source must sit
;; directly inside a `<=`/`<` ceiling expression (the comparison style
;; line 358 uses), never compared for exact equality (a reintroduced
;; pinned length, this ticket's own root cause). Reruns on every runner
;; invocation, so a future edit that reintroduces a pinned length fails
;; here instead of going unnoticed for a day.
(let [self-source (slurp *file*)
      code-line? (fn [line] (and (not (str/starts-with? (str/trim line) ";"))
                                  (not (str/includes? line "BL-1844 D1"))
                                  (not (str/includes? line "str/includes?"))))
      count-lines (->> (str/split-lines self-source)
                        (filter #(str/includes? % "count (:system-prompt"))
                        (filter code-line?))
      ceiling-pattern #"\(<=?\s*\(count \(:system-prompt"]
  (assert-true "BL-1844 D1: at least one (count (:system-prompt ...)) usage exists to self-check"
               (seq count-lines))
  (doseq [line count-lines]
    (assert-true (str "BL-1844 D1: (count (:system-prompt ...)) sits inside a <=/< ceiling, never a pinned-length equality: " (str/trim line))
                 (re-find ceiling-pattern line))))

;; ── report ──────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
