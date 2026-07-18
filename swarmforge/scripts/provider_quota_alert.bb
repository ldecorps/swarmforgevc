#!/usr/bin/env bb
;; Reusable provider-quota alert: probe configured LLM API keys, and when
;; one newly dries up, post to the SAME OPERATOR Telegram reply-outbox path
;; disk-space alerts use (bridge delivers to the standing Operator topic).
;;
;; Usage:
;;   provider_quota_alert.bb <project-root> [--dry-run]
;;
;; Env:
;;   PROVIDER_QUOTA_FORCE_RESULT  JSON object of provider -> {status,detail}
;;                                (test seam; skips real HTTP when set)
;;   OPENAI_API_KEY / MISTRAL_API_KEY / GEMINI_API_KEY /
;;   PERPLEXITY_API_KEY / DEEPSEEK_API_KEY
;;
;; Exit 0 always after a successful sweep (including no-op / dry-run).
;; Exit 2 on usage error. Network probe failures classify as :unknown and
;; never crash the sweep.

(ns provider-quota-alert
  (:require [babashka.fs :as fs]
            [babashka.http-client :as http]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "provider_quota_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: provider_quota_alert.bb <project-root> [--dry-run]"))
  (System/exit 2))

(def args *command-line-args*)
(when (or (empty? args) (#{"-h" "--help"} (first args))) (usage))
(def project-root (first args))
(def dry-run? (boolean (some #{"--dry-run"} (rest args))))

(def op-dir (fs/path project-root ".swarmforge" "operator"))
(def state-file (fs/path op-dir "provider-quota-state.json"))
(def reply-outbox-file (fs/path op-dir "telegram-reply-outbox.jsonl"))

(defn read-state []
  (or (when (fs/exists? state-file)
        (try (json/parse-string (slurp (str state-file)) false) (catch Exception _ nil)))
      {}))

(defn write-state! [m]
  (fs/create-dirs (fs/parent state-file))
  (spit (str state-file) (json/generate-string m)))

(defn append-operator-alert! [text]
  (fs/create-dirs (fs/parent reply-outbox-file))
  (spit (str reply-outbox-file)
        (str (json/generate-string {"threadId" "OPERATOR" "text" text}) "\n")
        :append true))

(defn- http-post-json [url headers body]
  (try
    (let [res (http/post url {:headers headers
                              :body (json/generate-string body)
                              :throw false})]
      {:http-status (:status res) :body (str (:body res))})
    (catch Exception e
      {:http-status 0 :error (.getMessage e)})))

(defmulti probe-provider identity)

(defmethod probe-provider :openai [_]
  (let [key (System/getenv "OPENAI_API_KEY")]
    (http-post-json "https://api.openai.com/v1/chat/completions"
                    {"Authorization" (str "Bearer " key)
                     "Content-Type" "application/json"}
                    {:model "gpt-4.1-mini"
                     :messages [{:role "user" :content "ping"}]
                     :max_tokens 8})))

(defmethod probe-provider :mistral [_]
  (let [key (System/getenv "MISTRAL_API_KEY")]
    (http-post-json "https://api.mistral.ai/v1/chat/completions"
                    {"Authorization" (str "Bearer " key)
                     "Content-Type" "application/json"}
                    {:model "mistral-small-latest"
                     :messages [{:role "user" :content "ping"}]
                     :max_tokens 8})))

(defmethod probe-provider :gemini [_]
  (let [key (System/getenv "GEMINI_API_KEY")
        url (str "https://generativelanguage.googleapis.com/v1beta/models/"
                 "gemini-2.5-flash:generateContent?key=" key)]
    (http-post-json url
                    {"Content-Type" "application/json"}
                    {:contents [{:parts [{:text "ping"}]}]
                     :generationConfig {:maxOutputTokens 8}})))

(defmethod probe-provider :perplexity [_]
  (let [key (System/getenv "PERPLEXITY_API_KEY")]
    (http-post-json "https://api.perplexity.ai/chat/completions"
                    {"Authorization" (str "Bearer " key)
                     "Content-Type" "application/json"}
                    {:model "sonar"
                     :messages [{:role "user" :content "ping"}]
                     :max_tokens 16})))

(defmethod probe-provider :deepseek [_]
  (let [key (System/getenv "DEEPSEEK_API_KEY")]
    (http-post-json "https://api.deepseek.com/chat/completions"
                    {"Authorization" (str "Bearer " key)
                     "Content-Type" "application/json"}
                    {:model "deepseek-chat"
                     :messages [{:role "user" :content "ping"}]
                     :max_tokens 8})))

(defmethod probe-provider :default [p]
  {:http-status 0 :error (str "no probe for " p)})

(defn forced-readings
  "PROVIDER_QUOTA_FORCE_RESULT JSON: {\"openai\":{\"status\":\"dry\",\"detail\":\"...\"}, ...}"
  []
  (when-let [raw (System/getenv "PROVIDER_QUOTA_FORCE_RESULT")]
    (into {}
          (for [[k v] (json/parse-string raw true)]
            [(keyword k) {:status (keyword (:status v))
                          :detail (or (:detail v) "")}]))))

(defn live-readings [providers]
  (into {}
        (for [p providers]
          [p (provider-quota-lib/classify-probe (probe-provider p))])))

(defn collect-readings []
  (or (forced-readings)
      (live-readings (provider-quota-lib/configured-providers))))

(defn min-interval-ms
  "Default 10 minutes between live probes (FORCE_RESULT always probes)."
  []
  (try
    (* 1000 (Long/parseLong (or (System/getenv "PROVIDER_QUOTA_MIN_INTERVAL_SEC") "600")))
    (catch Exception _ 600000)))

(defn now-ms [] (System/currentTimeMillis))

(defn skip-probe?
  "True when a live probe would be too soon. FORCE_RESULT never skips."
  [state]
  (and (nil? (System/getenv "PROVIDER_QUOTA_FORCE_RESULT"))
       (let [last (get state "__lastProbeMs" 0)
             last-n (if (number? last) last (try (Long/parseLong (str last)) (catch Exception _ 0)))]
         (< (- (now-ms) last-n) (min-interval-ms)))))

(defn run-sweep!
  "Reusable entry used by this CLI and operator_runtime's thin wrapper.
   adapters: {:readings! fn :read-state! fn :write-state! fn :alert! fn :now-ms! fn}
   Defaults to real probe + OPERATOR outbox. Returns the decision map
   (or {:skipped true} when min-interval suppresses a live probe)."
  ([]
   (run-sweep! {:readings! collect-readings
                :read-state! read-state
                :write-state! write-state!
                :now-ms! now-ms
                :alert! (if dry-run?
                          (fn [text] (println "DRY-RUN would alert:\n" text))
                          append-operator-alert!)}))
  ([adapters]
   (let [prior ((:read-state! adapters))]
     (if (skip-probe? prior)
       {:skipped true :just-dried [] :messages [] :next-state prior}
       (let [readings ((:readings! adapters))
             {:keys [messages next-state] :as decision}
             (provider-quota-lib/provider-quota-decision readings prior)
             stamped (assoc next-state "__lastProbeMs" ((:now-ms! adapters)))]
         (doseq [{:keys [text]} messages]
           ((:alert! adapters) text))
         ((:write-state! adapters) (merge prior stamped))
         decision)))))

(defn -main []
  (when-not (fs/directory? project-root)
    (binding [*out* *err*] (println "project-root is not a directory:" project-root))
    (System/exit 2))
  (let [decision (run-sweep!)
        summary (cond-> {:alerted (boolean (seq (:messages decision)))
                         :justDried (mapv name (:just-dried decision))
                         :nextState (:next-state decision)
                         :dryRun dry-run?}
                  (:skipped decision) (assoc :skipped true))]
    (println (json/generate-string summary))))

(-main)
