;; provider_compat_lib.bb — pure OpenAI-compat provider↔key invariants (SRE).
;;
;; Incident 2026-07-19: perplexity-mono-router window lines passed
;; --openai-api-base https://api.perplexity.ai while panes kept host
;; OPENAI_API_KEY=sk-* (real OpenAI). Aider → Perplexity returned 401
;; Invalid API key; dashboards stayed "healthy". Soft coupling between
;; pack CLI, SWARMFORGE_USE_PERPLEXITY, tmux -e, and launch-script guards
;; allowed the mismatch.
;;
;; This lib is the single decision point: given launch CLI + env flags +
;; keys, what OPENAI_* must the pane run with, and is a live env a mismatch?

(ns provider-compat-lib
  (:require [clojure.string :as str]))

(def perplexity-host-re #"(?i)api\.perplexity\.ai")
(def cerebras-host-re #"(?i)api\.cerebras\.ai")

(defn launch-cli-implies-perplexity?
  "True when the role's extra CLI / launch body targets Perplexity's OpenAI-compat host."
  [launch-cli]
  (boolean (and (string? launch-cli)
                (re-find perplexity-host-re launch-cli))))

(defn launch-cli-implies-cerebras?
  [launch-cli]
  (boolean (and (string? launch-cli)
                (re-find cerebras-host-re launch-cli))))

(defn openai-key-family
  "Coarse family for an OPENAI_API_KEY value. Never logs the key."
  [key]
  (cond
    (str/blank? key) :missing
    (str/starts-with? key "pplx-") :perplexity
    (or (str/starts-with? key "sk-")
        (str/starts-with? key "sk-proj-")) :openai
    (str/starts-with? key "csk-") :cerebras
    :else :unknown))

(defn must-remap-to-perplexity?
  "Hard invariant: remap when the flag is on OR the launch CLI targets Perplexity."
  [{:keys [use-perplexity launch-cli]}]
  (or (= true use-perplexity)
      (= "1" use-perplexity)
      (launch-cli-implies-perplexity? launch-cli)))

(defn must-remap-to-cerebras?
  [{:keys [use-cerebras launch-cli]}]
  (or (= true use-cerebras)
      (= "1" use-cerebras)
      (launch-cli-implies-cerebras? launch-cli)))

(defn resolve-openai-compat
  "Returns {:openai-api-key :openai-api-base :openai-base-url :provider :reason}
   for the pane. Prefer Cerebras over Perplexity if both somehow apply (explicit
   flag order matches swarmforge.sh). Never embeds secrets into reason strings
   beyond family labels."
  [{:keys [use-perplexity use-cerebras
           perplexity-api-key cerebras-api-key openai-api-key
           launch-cli]
    :as opts}]
  (cond
    (and (must-remap-to-cerebras? opts) (not (str/blank? cerebras-api-key)))
    {:openai-api-key cerebras-api-key
     :openai-api-base "https://api.cerebras.ai/v1"
     :openai-base-url "https://api.cerebras.ai/v1"
     :provider :cerebras
     :reason :cerebras-compat}

    (and (must-remap-to-perplexity? opts) (not (str/blank? perplexity-api-key)))
    {:openai-api-key perplexity-api-key
     :openai-api-base "https://api.perplexity.ai"
     :openai-base-url "https://api.perplexity.ai"
     :provider :perplexity
     :reason (if (launch-cli-implies-perplexity? launch-cli)
               :launch-cli-perplexity
               :use-perplexity-flag)}

    (and (must-remap-to-perplexity? opts) (str/blank? perplexity-api-key))
    {:openai-api-key nil
     :openai-api-base "https://api.perplexity.ai"
     :openai-base-url "https://api.perplexity.ai"
     :provider :perplexity
     :reason :perplexity-key-missing}

    :else
    {:openai-api-key openai-api-key
     :openai-api-base nil
     :openai-base-url nil
     :provider :openai
     :reason :passthrough}))

(defn compat-mismatch?
  "True when a live pane's OPENAI_API_KEY family cannot serve its required provider.
   Evidence shape from 2026-07-19: required :perplexity, live family :openai."
  [resolved live-openai-key]
  (let [required (:provider resolved)
        live (openai-key-family live-openai-key)]
    (cond
      (= :perplexity-key-missing (:reason resolved)) true
      (= required :perplexity) (not= live :perplexity)
      (= required :cerebras) (not= live :cerebras)
      :else false)))

(defn provider-auth-error-text?
  "True when pane scrollback / provider error text indicates auth failure
   (same spirit as agent_runtime_lib/classify-provider-error :auth)."
  [text]
  (boolean
   (and (string? text)
        (re-find #"(?i)(invalid api[\s-]?key|authenticationerror|authentication failed|unauthorized)" text))))
