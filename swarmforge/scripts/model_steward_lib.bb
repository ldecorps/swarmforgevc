#!/usr/bin/env bb
;; Model Steward — pure decisions over the Model Registry, Capability
;; Registry, Role Recommendation Matrix, and Prompt Adapter catalogue
;; (BL-547 Slice 1). No disk IO here — model_steward_store.bb owns reading
;; and writing .swarmforge/model-steward/ and the committed seed under
;; swarmforge/model-steward/; this namespace only transforms plain data.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "model_steward_lib.bb")))
;; and referred to as model-steward-lib/foo.
(ns model-steward-lib
  (:require [clojure.string :as str]))

(def certified-status "certified")
(def candidate-status "candidate")
(def deprecated-status "deprecated")
(def non-certified-statuses #{candidate-status deprecated-status})

(def empty-registry
  {:models {}
   :capabilities {}
   :role_matrix {}
   :adapters {}})

(defn model-key [provider model]
  (str provider "/" model))

;; ── Model Registry ───────────────────────────────────────────────────────
(defn register-model
  "Adds or replaces a Model Registry entry. Status defaults to \"candidate\"
   when omitted — a newly-discovered model is never certified by default."
  [registry provider model {:keys [status context_window cost_class]}]
  (assoc-in registry [:models (model-key provider model)]
            {:provider provider
             :model model
             :status (or status candidate-status)
             :context_window context_window
             :cost_class cost_class
             :certification_report_path nil}))

(defn model-entry [registry provider model]
  (get-in registry [:models (model-key provider model)]))

(defn model-status [registry provider model]
  (:status (model-entry registry provider model)))

(defn certified? [registry provider model]
  (= certified-status (model-status registry provider model)))

(defn registry-summary
  "The status command's data source: every registered model, sorted for
   stable CLI output."
  [registry]
  (->> (vals (:models registry))
       (sort-by (juxt :provider :model))
       vec))

;; ── Capability Registry ──────────────────────────────────────────────────
(defn set-capability-entry [registry provider model capabilities]
  (assoc-in registry [:capabilities (model-key provider model)] capabilities))

(defn capability-entry [registry provider model]
  (get-in registry [:capabilities (model-key provider model)]))

;; ── Role Recommendation Matrix ───────────────────────────────────────────
(defn add-role-ranking [registry role provider model score evidence]
  (update-in registry [:role_matrix role] (fnil conj [])
             {:provider provider :model model :score score :evidence evidence}))

(defn role-recommendations
  "Ranked entries for a role, highest score first. Excludes any model that
   is not certified unless :include-uncertified? is set — a non-certified
   model must never lead (or appear in) a production role recommendation
   (certification-gate-05)."
  [registry role & [{:keys [include-uncertified?]}]]
  (let [entries (get-in registry [:role_matrix role] [])
        eligible (if include-uncertified?
                   entries
                   (filter #(certified? registry (:provider %) (:model %)) entries))]
    (vec (sort-by :score > eligible))))

;; ── Prompt Adapter catalogue ─────────────────────────────────────────────
(defn set-adapter-entry [registry provider model adapter]
  (assoc-in registry [:adapters (model-key provider model)] adapter))

(defn adapter-for [registry provider model]
  (get-in registry [:adapters (model-key provider model)]))

(defn production-adapter-for
  "The adapter PromptEngine may use as a production default — nil unless
   the model is certified, even if a candidate adapter entry exists."
  [registry provider model]
  (when (certified? registry provider model)
    (let [adapter (adapter-for registry provider model)]
      (when (:production_default adapter)
        adapter))))

;; ── Certification gate (ModelFactory assign() contract) ──────────────────
(defn assignment-eligible?
  "The certification gate ModelFactory's assign() consults in production
   mode: a non-certified model is excluded unless the caller explicitly
   sets :override-uncertified? (certification-gate-05)."
  [registry provider model & [{:keys [override-uncertified?]}]]
  (boolean (or override-uncertified? (certified? registry provider model))))

;; ── Certification / decertification ──────────────────────────────────────
(defn- require-registered [registry provider model]
  (when-not (model-entry registry provider model)
    (throw (ex-info "no registry entry for provider/model — register-model first"
                     {:provider provider :model model}))))

(defn certify
  "Flips a model to certified and records where its certification report
   artifact was written (the caller/store persists the report file itself;
   this only records the path on the registry entry). Requires the model to
   already have a registry entry — update-in's nil-merge would otherwise
   silently create one missing :provider/:model."
  [registry provider model report-path]
  (require-registered registry provider model)
  (-> registry
      (update-in [:models (model-key provider model)] assoc
                 :status certified-status
                 :certification_report_path report-path)))

(defn decertify
  "Moves a certified model off certified status on regression, recording
   the reason and the regression report artifact path on the registry entry
   (decertify-on-regression-07 — the certification report, not just the
   entry, must carry the regression reason; report-path is the caller/store's
   write-certification-report! result, mirroring how certify records its
   own report-path). new-status must be \"candidate\" or \"deprecated\" —
   certify is the only path back to certified. Requires the model to already
   have a registry entry, for the same reason as certify above."
  [registry provider model report-path {:keys [reason new-status]}]
  (require-registered registry provider model)
  (when-not (contains? non-certified-statuses new-status)
    (throw (ex-info "decertify requires new-status to be candidate or deprecated"
                     {:new-status new-status})))
  (update-in registry [:models (model-key provider model)] assoc
             :status new-status
             :last_regression_reason reason
             :certification_report_path report-path))

(defn build-certification-report
  "A Slice 1 manual-certification report: no automated benchmark ingestion
   yet (that is Slice 2's `evaluate`), so gate-results may be empty — the
   operator vouches for the model by invoking certify."
  [provider model gate-results timestamp]
  {:provider provider
   :model model
   :timestamp timestamp
   :result certified-status
   :gates (vec gate-results)})

(defn build-regression-report
  "A decertification report referencing the certification it regressed
   from, so the artifact trail shows what was lost and why. provider/model
   are taken directly rather than read off prior-report, because a model
   certified via the committed seed (never run through the `certify`
   command) has no prior report at all — prior-report is nil in that case,
   and deriving identity from it would silently record a provider-less,
   model-less regression report."
  [provider model prior-report reason timestamp]
  {:provider provider
   :model model
   :timestamp timestamp
   :result "regressed"
   :reason reason
   :prior_report prior-report})

;; ── Seed transform (committed schema+seed -> a fresh registry) ──────────
(defn seed-data->registry
  "Turns the parsed, committed swarmforge/model-steward/seed/models.seed.json
   into a Model Steward registry. Pure — model_steward_store.bb owns
   reading the seed file off disk; this only interprets the parsed data."
  [{:keys [models capabilities role_matrix adapters]}]
  (reduce
   (fn [registry {:keys [provider model status context_window cost_class]}]
     (register-model registry provider model
                      {:status status :context_window context_window :cost_class cost_class}))
   (assoc empty-registry
          :capabilities (into {} (map (fn [[k v]] [(name k) v]) capabilities))
          :role_matrix (into {} (map (fn [[k v]] [(name k) (vec v)]) role_matrix))
          :adapters (into {} (map (fn [[k v]] [(name k) v]) adapters)))
   models))
