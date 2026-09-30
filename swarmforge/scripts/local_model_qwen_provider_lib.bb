;; BL-1838: the PURE shape of a local-model seat's qwen provider entry
;; (modelProviders.openai), how it merges into an existing settings map, and
;; which window it is budgeted to. Kept separate from the CLI (which
;; gathers the facts: served-window's curl, reading/writing the settings
;; file) so all of this is testable with no HTTP call, no subprocess, no
;; filesystem - same split as
;; local_model_window_gate_lib.bb/local_model_window_gate_cli.bb.
(ns local-model-qwen-provider-lib
  (:require [clojure.string :as str]))

(defn parse-context-length [s]
  (when-not (str/blank? (str s))
    (try (Long/parseLong (str/trim (str s))) (catch Exception _ nil))))

;; BL-1838's own declared invariant: "A local-model seat's qwen context
;; budget equals the window its model is served with, or the swarm's
;; configured context length when Ollama reports none; never a value only
;; the operator's ~/.qwen/settings.json holds." served-window/context-length
;; are already-resolved values (no IO here) so the property test
;; (bl1838QwenBudgetsTheServedWindow.property.test.js) can generate every
;; combination directly, with no HTTP call and no subprocess per case.
(defn resolve-window
  "The context window to budget a qwen provider entry to: served-window
   (Ollama's own num_ctx) when known, else the parsed context-length-str,
   else nil - meaning no known window at all, so the caller (write-provider!)
   writes no entry rather than inventing one."
  [served-window context-length-str]
  (or served-window (parse-context-length context-length-str)))

;; The shape to copy - the gitignored master ~/.qwen/settings.json's
;; ista-iq3s-coder:latest entry (timeout, streamIdleTimeoutMs, maxRetries,
;; extra_body.think false, samplingParams) - fixed across every seat/model;
;; only :id, :name, :baseUrl and :generationConfig's :contextWindowSize vary.
(def generation-config-fixed
  {:timeout 600000
   :streamIdleTimeoutMs 900000
   :maxRetries 1
   :extra_body {:think false}
   :samplingParams {:temperature 0.3 :top_p 0.9}})

(defn provider-entry
  "The modelProviders.openai entry for model, budgeted to window."
  [model endpoint-url window]
  {:id model
   :name (str "[Local Ollama] " model)
   :baseUrl endpoint-url
   :envKey "OLLAMA_API_KEY"
   :generationConfig (assoc generation-config-fixed :contextWindowSize window)})

(defn merge-provider-entry
  "existing-settings (a map; {} for an absent/empty file) with model's
   modelProviders.openai entry set - replacing an existing entry sharing
   model's :id, else appended. Every other key (BL-1829's coreTools/
   excludeTools/tools) passes through untouched."
  [existing-settings model endpoint-url window]
  (let [entry (provider-entry model endpoint-url window)
        providers (get-in existing-settings [:modelProviders :openai] [])
        without (vec (remove #(= (:id %) model) providers))]
    (assoc-in existing-settings [:modelProviders :openai] (conj without entry))))
