#!/usr/bin/env bb
;; Pure decision logic for provider-quota / "dried up" Telegram alerts.
;; Same change-gated posture as disk_space_lib.bb (BL-412): announce only on
;; a TRANSITION into :dry, never every tick. Delivery (OPERATOR reply-outbox)
;; lives in provider_quota_alert.bb / operator_runtime.bb's sweep.

(ns provider-quota-lib
  (:require [clojure.string :as str]))

(def known-providers [:openai :mistral :gemini :perplexity :deepseek])

(def provider-labels
  {:openai "OpenAI"
   :mistral "Mistral"
   :gemini "Gemini"
   :perplexity "Perplexity"
   :deepseek "DeepSeek"})

(defn env-has-key?
  "Pure: looks up the env MAP for a provider's API key name. Never calls
   System/getenv - tests inject a plain map."
  [env provider]
  (let [names {:openai "OPENAI_API_KEY"
               :mistral "MISTRAL_API_KEY"
               :gemini "GEMINI_API_KEY"
               :perplexity "PERPLEXITY_API_KEY"
               :deepseek "DEEPSEEK_API_KEY"}
        k (get names provider)]
    (boolean (and k (not (str/blank? (str (get env k ""))))))))

(defn configured-providers
  "Providers that have a non-blank key in env (injected map)."
  ([env] (filterv #(env-has-key? env %) known-providers))
  ([] (configured-providers (into {} (System/getenv)))))

(defn dry-detail?
  "True when HTTP body / error text clearly means quota/billing exhaustion
   (not a transient rate limit)."
  [detail]
  (boolean
   (re-find #"(?i)quota|billing|insufficient[_\s-]?credits|exceeded your current quota|plan and billing|payment|credit[s]?\s+(exhausted|depleted)|no\s+credits"
            (str detail))))

(defn classify-probe
  "Maps a probe result {:http-status N :body s :error s} onto
   {:status :ok|:dry|:auth_error|:unknown :detail s}."
  [{:keys [http-status body error]}]
  (let [detail (str (or error "") " " (or body ""))
        status (or http-status 0)]
    (cond
      (and (<= 200 status 299)) {:status :ok :detail "ok"}
      (or (= status 401) (= status 403)
          (re-find #"(?i)invalid api[\s-]?key|unauthorized|forbidden|authentication" detail))
      {:status :auth_error :detail (str/trim detail)}
      (or (dry-detail? detail)
          (and (= status 429) (dry-detail? detail))
          (and (= status 402) true))
      {:status :dry :detail (str/trim detail)}
      (= status 429) {:status :rate_limited :detail (str/trim detail)}
      :else {:status :unknown :detail (str/trim (str status " " detail))})))

(defn- label [provider]
  (get provider-labels provider (name provider)))

(defn- join-labels [providers]
  (if (seq providers)
    (str/join ", " (map label providers))
    "(none)"))

(defn format-provider-dry-alert
  "Human Telegram text: which just dried, which are also dry, which are not."
  [just-dried readings]
  (let [statuses (into {} (map (fn [[p r]] [p (:status r)]) readings))
        all-dry (vec (filter #(= :dry (get statuses %)) (keys readings)))
        also-dry (vec (remove (set just-dried) all-dry))
        not-dry (vec (filter #(not= :dry (get statuses %)) (keys readings)))
        just-line (if (= 1 (count just-dried))
                    (str (label (first just-dried)) " just ran out of quota.")
                    (str (join-labels just-dried) " just ran out of quota."))]
    (str "🔴 PROVIDER DRY — " just-line "\n"
         "\n"
         "Also dry: " (join-labels also-dry) "\n"
         "Not dry: " (join-labels not-dry))))

;; Pure: readings is provider-kw -> {:status ...}; prior-state is
;; provider-NAME string -> status-NAME string (JSON round-trip). Default
;; prior for a never-seen provider is "ok" so a first dry reading alerts
;; once (same posture as disk-space defaulting prior to healthy).
(defn provider-quota-decision [readings prior-state]
  (let [next-state (into {}
                         (for [[p r] readings]
                           [(name p) (name (:status r))]))
        just-dried (vec
                    (for [[p r] readings
                          :when (= :dry (:status r))
                          :let [prev (keyword (get prior-state (name p) "ok"))]
                          :when (not= prev :dry)]
                      p))]
    {:just-dried just-dried
     :next-state next-state
     :messages (if (seq just-dried)
                 [{:level :dry
                   :just-dried just-dried
                   :text (format-provider-dry-alert just-dried readings)}]
                 [])}))
