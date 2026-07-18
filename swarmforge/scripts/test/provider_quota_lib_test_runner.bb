#!/usr/bin/env bb
;; TDD runner for provider_quota_lib.bb — pure assertions, no network.
(ns provider-quota-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "provider_quota_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg "\n  expected truthy, got: " (pr-str actual)))))

;; ── configured-providers ───────────────────────────────────────────────────
(assert= "configured-providers: empty env -> none"
         [] (provider-quota-lib/configured-providers {}))
(assert= "configured-providers: only OpenAI+Gemini keys"
         [:openai :gemini]
         (provider-quota-lib/configured-providers
          {"OPENAI_API_KEY" "sk-x" "GEMINI_API_KEY" "g-x" "MISTRAL_API_KEY" ""}))

;; ── classify-probe ─────────────────────────────────────────────────────────
(assert= "classify: 200 -> ok" :ok
         (:status (provider-quota-lib/classify-probe {:http-status 200 :body "{}"})))
(assert= "classify: OpenAI quota 429 -> dry" :dry
         (:status (provider-quota-lib/classify-probe
                   {:http-status 429
                    :body "{\"error\":{\"message\":\"You exceeded your current quota, please check your plan and billing details.\"}}"})))
(assert= "classify: transient 429 without quota wording -> rate_limited" :rate_limited
         (:status (provider-quota-lib/classify-probe
                   {:http-status 429 :body "Too Many Requests - rate limit exceeded, back off"})))
(assert= "classify: 401 -> auth_error" :auth_error
         (:status (provider-quota-lib/classify-probe
                   {:http-status 401 :body "Invalid API key"})))
(assert= "classify: 402 payment -> dry" :dry
         (:status (provider-quota-lib/classify-probe {:http-status 402 :body "Payment required"})))

;; ── decision: alert only on transition into dry ────────────────────────────
(let [readings {:openai {:status :dry :detail "quota"}
                :mistral {:status :ok :detail "ok"}
                :gemini {:status :ok :detail "ok"}}
      result (provider-quota-lib/provider-quota-decision readings {"openai" "ok"})]
  (assert= "dry transition: exactly one message" 1 (count (:messages result)))
  (assert= "dry transition: just-dried is openai" [:openai] (:just-dried result))
  (assert= "dry transition: persists dry" "dry" (get (:next-state result) "openai"))
  (assert-true "message names OpenAI as just dried"
               (boolean (re-find #"OpenAI just ran out of quota" (:text (first (:messages result))))))
  (assert-true "message lists Not dry providers"
               (boolean (re-find #"Not dry: Mistral, Gemini" (:text (first (:messages result))))))
  (assert-true "message Also dry is none when only one dry"
               (boolean (re-find #"Also dry: \(none\)" (:text (first (:messages result)))))))

(let [result (provider-quota-lib/provider-quota-decision
              {:openai {:status :dry :detail "q"} :mistral {:status :dry :detail "q"}}
              {"openai" "dry" "mistral" "ok"})]
  (assert= "second provider drying: just-dried is mistral only" [:mistral] (:just-dried result))
  (assert-true "Also dry includes already-dry openai"
               (boolean (re-find #"Also dry: OpenAI" (:text (first (:messages result)))))))

(let [result (provider-quota-lib/provider-quota-decision
              {:openai {:status :dry :detail "q"}} {"openai" "dry"})]
  (assert= "unchanged dry: no message" 0 (count (:messages result))))

(let [result (provider-quota-lib/provider-quota-decision
              {:openai {:status :ok :detail "ok"}} {"openai" "dry"})]
  (assert= "recovery to ok: no dry-alert message (only dry transitions alert)"
           0 (count (:messages result))))

(let [result (provider-quota-lib/provider-quota-decision
              {:openai {:status :dry :detail "q"} :mistral {:status :dry :detail "q"}}
              {})]
  (assert= "first sighting of two dry providers: both just-dried"
           #{:openai :mistral} (set (:just-dried result)))
  (assert-true "multi just-dried message lists both labels"
               (let [t (:text (first (:messages result)))]
                 (and (re-find #"OpenAI" t) (re-find #"Mistral" t) (re-find #"just ran out of quota" t)))))

;; ── format content contract ────────────────────────────────────────────────
(let [text (provider-quota-lib/format-provider-dry-alert
            [:openai]
            {:openai {:status :dry} :mistral {:status :dry} :gemini {:status :ok}})]
  (assert-true "format starts with PROVIDER DRY" (str/starts-with? text "🔴 PROVIDER DRY"))
  (assert-true "format has Also dry line" (boolean (re-find #"Also dry: Mistral" text)))
  (assert-true "format has Not dry line" (boolean (re-find #"Not dry: Gemini" text))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: provider_quota_lib.bb"))
