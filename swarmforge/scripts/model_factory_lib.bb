#!/usr/bin/env bb
;; ModelFactory — pure decisions over a Model Steward registry snapshot
;; (BL-525 Slice 1). No disk IO here — model_factory_store.bb owns reading
;; and writing .swarmforge/model-factory/ and invoking the cold-apply launch
;; seam; this namespace only transforms plain data. Mirrors the Model
;; Steward split (model_steward_lib.bb / model_steward_store.bb).
;;
;; ModelFactory CONSUMES the Steward read API — role-recommendations,
;; assignment-eligible?, model-entry — via model_steward_lib.bb. It never
;; re-implements registry/certification decisions.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "model_factory_lib.bb")))
;; and referred to as model-factory-lib/foo. Callers must also load
;; model_steward_lib.bb first (model-steward-lib/* is referenced directly).
(ns model-factory-lib)

(def cheap-mode "cheap")
(def quality-mode "quality")
(def steering-modes #{cheap-mode quality-mode})

;; The seven pipeline roles ModelFactory resolves a full-swarm assignment
;; for — matches swarmforge/model-steward/seed/models.seed.json's role_matrix
;; keys and PIPELINE.md's chain (coordinator is a separate always-on process,
;; never assigned a swarm role model here).
(def swarm-roles ["architect" "coder" "cleaner" "QA" "hardender" "documenter" "specifier"])

;; A model's cost_class (Model Registry metadata) ranked low-to-high for
;; cheap-mode's "lowest $/quality that still meets the role floor" rule.
;; An unknown/missing cost_class sorts last (never preferred over a known-cheap
;; option) rather than raising — a registry entry lacking cost_class metadata
;; should not silently win cheap mode by accident of missing data.
(def cost-rank {"low" 0 "medium" 1 "high" 2})
(def unknown-cost-rank 3)

(defn cost-class-rank [cost-class]
  (get cost-rank cost-class unknown-cost-rank))

;; Provider -> agent runtime that launches a pane on that provider, mirroring
;; the `window <role> <agent> ...` lines in swarmforge/packs/*.conf
;; (cerebras-mono-router.conf uses aider, codex-mono-router.conf uses codex,
;; openrouter-anthropic-mono-router.conf uses claude). ModelFactory's
;; assignment descriptor names an agent alongside provider+model so a cold
;; apply plan can select a launch pack without the caller re-deriving it.
(def provider->agent
  {"anthropic" "claude"
   "openai" "codex"
   "cerebras" "aider"})

(defn agent-for-provider [provider]
  (get provider->agent provider provider))

(defn eligible-candidates
  "Role-recommendation entries for `role`, filtered to the certification gate
   (model_steward_lib.bb/assignment-eligible?) — a non-certified model is
   excluded unless :override-uncertified? is set. Ranking order (score desc)
   is preserved from role-recommendations; :include-uncertified? true is
   always passed to the underlying steward query because the eligibility
   filter below is the actual gate, not the steward's own default filter —
   this lets an override see (and select) a candidate-status entry that
   role-recommendations would otherwise have dropped."
  [steward-registry role & [{:keys [override-uncertified?]}]]
  (->> (model-steward-lib/role-recommendations steward-registry role {:include-uncertified? true})
       (filter #(model-steward-lib/assignment-eligible?
                 steward-registry (:provider %) (:model %)
                 {:override-uncertified? override-uncertified?}))
       vec))

(defn exhausted-today?
  "A provider's free-daily quota is exhausted only when the last recorded
   exhausted_date equals `today` exactly — a pure predicate over an injected
   quota-state map and an injected `today` (never a wall-clock read), so
   acceptance can force any date. A prior day's exhausted_date (quota reset)
   or a provider with no entry is never treated as exhausted."
  [quota-state provider today]
  (boolean (and today (= today (get-in quota-state [(keyword provider) :exhausted_date])))))

(defn exclude-exhausted [candidates quota-state today]
  (remove #(exhausted-today? quota-state (:provider %) today) candidates))

(defn pick-quality
  "Quality mode: the top-ranked eligible candidate — role-recommendations
   already sorts by score descending, so this is simply the first eligible
   survivor, regardless of its cost_class."
  [candidates]
  (first candidates))

(defn pick-cheap
  "Cheap mode: the lowest cost_class eligible, non-exhausted candidate that
   meets the role floor (score used only to break a cost_class tie, highest
   first — cost dominates, per the ticket's \"lowest $/quality\" rule)."
  [steward-registry candidates]
  (->> candidates
       (sort-by (fn [{:keys [provider model score]}]
                  [(cost-class-rank (:cost_class (model-steward-lib/model-entry steward-registry provider model)))
                   (- score)]))
       first))

(defn build-reason
  "Human-readable rationale recorded on every assignment entry. Names the
   steering rule that won and any override/exclusion applied — the
   uncertified-override-05 scenario asserts the literal substring
   \"uncertified override\" appears here whenever one was used. `chosen` is
   the raw role-recommendation entry ({:provider :model :score :evidence}),
   which carries no cost_class of its own — look it up from the registry
   rather than reading a key that is never there."
  [steward-registry mode chosen {:keys [override-uncertified? excluded-providers]}]
  (let [rule (if (= mode cheap-mode)
               (str "cheap: lowest-cost eligible candidate (cost_class="
                    (or (:cost_class (model-steward-lib/model-entry steward-registry (:provider chosen) (:model chosen))) "unknown") ")")
               (str "quality: top-ranked eligible candidate (score=" (:score chosen) ")"))
        override-note (when override-uncertified? "; uncertified override used")
        exclusion-note (when (seq excluded-providers)
                         (str "; excluded exhausted providers: " (clojure.string/join "," excluded-providers)))]
    (str rule override-note exclusion-note)))

(defn assign-role
  "Resolves one role's assignment under `mode`. `opts` may carry
   :override-uncertified? and :quota-state + :today (cheap mode only —
   quality mode never excludes on quota, matching the ticket's steering
   rules: quota exhaustion is a cheap-mode-only input). Returns nil when no
   eligible candidate survives (an empty role matrix, or every eligible
   candidate's provider exhausted today)."
  [steward-registry role mode & [opts]]
  (let [{:keys [override-uncertified? quota-state today]} opts
        quota-state (or quota-state {})
        candidates (eligible-candidates steward-registry role {:override-uncertified? override-uncertified?})
        cheap? (= mode cheap-mode)
        excluded-providers (when cheap?
                              (->> candidates
                                   (filter #(exhausted-today? quota-state (:provider %) today))
                                   (map :provider)
                                   distinct
                                   vec))
        survivors (if cheap? (exclude-exhausted candidates quota-state today) candidates)
        chosen (cond
                 (empty? survivors) nil
                 cheap? (pick-cheap steward-registry survivors)
                 :else (pick-quality survivors))]
    (when chosen
      {:role role
       :agent (agent-for-provider (:provider chosen))
       :provider (:provider chosen)
       :model (:model chosen)
       :policy mode
       :reason (build-reason steward-registry mode chosen {:override-uncertified? override-uncertified?
                                           :excluded-providers excluded-providers})})))

(defn assign-swarm
  "Resolves every role in `swarm-roles` under `mode`, returning a map of
   role -> assignment entry. A role with no eligible candidate is simply
   absent from the map — assign-role already reports nil for it; the caller
   (CLI) decides whether an incomplete map is acceptable."
  [steward-registry mode & [opts]]
  (into {}
        (keep (fn [role]
                (when-let [entry (assign-role steward-registry role mode opts)]
                  [role entry])))
        swarm-roles))

(defn cold-apply-plan
  "The Slice 1 apply plan: stop the running swarm, then relaunch it against
   `pack-name` with the resolved assignment materialised at `overlay-path`.
   Pure data only — no process is started here; model_factory_store.bb's
   invoke-launch-seam! is what actually executes (or, in tests, stubs) this
   plan. Mirrors failover_to_gpt.sh's proven sequence
   (kill_all_swarm.sh + ./swarm --pack <resolved>)."
  [pack-name overlay-path]
  {:overlay_path overlay-path
   :pack pack-name
   :stop {:action "stop" :script "kill_all_swarm.sh"}
   :relaunch {:action "relaunch" :script "swarm" :args ["--pack" pack-name]}})

(defn resolve-role-model
  "BL-563 Slice 1: the pure overlay-over-pack decision applied at
   write_claude_settings_file/write_agent_instruction_file time. `overlay` is
   whatever model-factory-store/read-assignment-overlay! returned — a parsed
   role-keyword -> assignment-entry map for a well-formed overlay, or nil for
   a missing/unreadable/malformed/truncated/empty one (that reader's own
   degrade-never-crash contract, mirroring backlog_depth_lib.bb's readers).
   `pack-model` passes straight through whenever the overlay is not a map,
   names no entry for `role`, or that entry's :model is blank — the overlay
   only overrides fields it actually names (ticket's own contract); every
   other case returns the overlay's named model instead."
  [overlay role pack-model]
  (let [overlay-model (when (map? overlay) (:model (get overlay (keyword role))))]
    (if (clojure.string/blank? overlay-model) pack-model overlay-model)))
