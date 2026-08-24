#!/usr/bin/env bb
;; BL-682 — pure helpers that turn a Vibe config report into a Model Steward
;; registration plan. No disk IO: callers supply a parsed config map (or nil).
;; The Intelligence Layer must never invent a model id; every id is either the
;; config's stable alias or the explicit agent-granularity fallback with a
;; recorded reason.
;;
;;   (load-file ".../mistral_vibe_registration_lib.bb")
;;   mistral-vibe-registration-lib/registration-from-vibe-config
(ns mistral-vibe-registration-lib
  (:require [clojure.string :as str]))

(def mistral-provider "mistral")
(def vibe-agent "vibe")
(def agent-granularity-model vibe-agent)

(defn cost-class-from-token-prices
  "Derive cost_class from declared token rates, never from a session spend
   cap. Bands are total input+output $/MTok: <1 low, <20 medium, else high —
   chosen so the live mistral-medium rates (1.5+7.5) land medium alongside
   the steward's other mid-tier seeds, not the intake's incorrect 'low' guess."
  [input-price output-price]
  (let [total (+ (double (or input-price 0)) (double (or output-price 0)))]
    (cond
      (< total 1.0) "low"
      (< total 20.0) "medium"
      :else "high")))

(defn- model-row-for-active [models active]
  (when (and active (seq models))
    (some (fn [row]
            (when (or (= active (:alias row))
                      (= active (:name row)))
              row))
          models)))

(defn- alias-registration [row]
  (let [alias (:alias row)
        name (:name row)]
    (when (and (string? alias) (not (str/blank? alias)))
      {:provider mistral-provider
       :model alias
       :status "candidate"
       :context_window (:auto_compact_threshold row)
       :cost_class (cost-class-from-token-prices (:input_price row) (:output_price row))
       :underlying_name name
       :trace (str "vibe-config alias=" alias " name=" name)})))

(defn- agent-granularity [reason]
  {:provider mistral-provider
   :model agent-granularity-model
   :status "candidate"
   :agent-granularity? true
   :reason reason
   :trace reason})

(defn registration-from-vibe-config
  "Plan a Mistral Model Steward registration from a parsed Vibe config map
   (`:active_model` + `:models` rows). Prefer the stable alias of the active
   model; never register a rolling `*-latest` name as the id. When the tool
   cannot supply an id, fall back to agent granularity (`mistral/vibe`) with
   an explicit reason — never a fabricated model string."
  [cfg]
  (if (nil? cfg)
    (agent-granularity "vibe config absent: no model id the tool could supply")
    (let [active (:active_model cfg)
          row (model-row-for-active (:models cfg) active)
          planned (when row (alias-registration row))]
      (cond
        planned planned
        (nil? active) (agent-granularity "vibe config has no active_model")
        (nil? row) (agent-granularity
                    (str "active_model " (pr-str active)
                         " matched no [[models]] row in vibe config"))
        :else (agent-granularity
               (str "active model " (pr-str active)
                    " has no stable alias to register"))))))
