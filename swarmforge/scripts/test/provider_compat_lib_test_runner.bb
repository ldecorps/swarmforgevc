#!/usr/bin/env bb
;; TDD runner for provider_compat_lib.bb — no network, no clock, no tmux.
(ns provider-compat-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "provider_compat_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── launch CLI detection ────────────────────────────────────────────────────
(assert-true "perplexity host in --openai-api-base"
             (provider-compat-lib/launch-cli-implies-perplexity?
              "--model openai/sonar-pro --openai-api-base https://api.perplexity.ai"))
(assert-true "plain openai base is not perplexity"
             (not (provider-compat-lib/launch-cli-implies-perplexity?
                   "--model gpt-4o --openai-api-base https://api.openai.com/v1")))
(assert-true "nil cli is safe"
             (not (provider-compat-lib/launch-cli-implies-perplexity? nil)))

;; ── key family ──────────────────────────────────────────────────────────────
(assert= "pplx family" :perplexity (provider-compat-lib/openai-key-family "pplx-abc"))
(assert= "sk family" :openai (provider-compat-lib/openai-key-family "sk-proj-abc"))
(assert= "missing" :missing (provider-compat-lib/openai-key-family ""))

;; ── must remap when CLI implies, even without flag (2026-07-19 invariant) ───
(assert-true "CLI alone forces perplexity remap"
             (provider-compat-lib/must-remap-to-perplexity?
              {:use-perplexity false
               :launch-cli "--openai-api-base https://api.perplexity.ai"}))
(assert-true "flag alone forces remap"
             (provider-compat-lib/must-remap-to-perplexity?
              {:use-perplexity "1" :launch-cli ""}))

;; ── resolve ─────────────────────────────────────────────────────────────────
(let [r (provider-compat-lib/resolve-openai-compat
         {:use-perplexity false
          :perplexity-api-key "pplx-secret"
          :openai-api-key "sk-proj-host"
          :launch-cli "--openai-api-base https://api.perplexity.ai"})]
  (assert= "CLI→perplexity key wins over host OPENAI"
           "pplx-secret" (:openai-api-key r))
  (assert= "provider perplexity" :perplexity (:provider r))
  (assert= "reason launch-cli" :launch-cli-perplexity (:reason r))
  (assert= "base" "https://api.perplexity.ai" (:openai-api-base r)))

(let [r (provider-compat-lib/resolve-openai-compat
         {:use-perplexity false
          :perplexity-api-key "pplx-secret"
          :openai-api-key "sk-proj-host"
          :launch-cli "--model gpt-4o"})]
  (assert= "no CLI/flag → passthrough host key"
           "sk-proj-host" (:openai-api-key r))
  (assert= "provider openai" :openai (:provider r)))

(let [r (provider-compat-lib/resolve-openai-compat
         {:use-perplexity "1"
          :perplexity-api-key ""
          :openai-api-key "sk-proj-host"
          :launch-cli "--openai-api-base https://api.perplexity.ai"})]
  (assert= "missing perplexity key is explicit"
           :perplexity-key-missing (:reason r)))

;; ── mismatch (the live incident shape) ──────────────────────────────────────
(let [resolved (provider-compat-lib/resolve-openai-compat
                {:launch-cli "--openai-api-base https://api.perplexity.ai"
                 :perplexity-api-key "pplx-ok"
                 :openai-api-key "sk-proj-host"})]
  (assert-true "sk-* live key vs perplexity required = mismatch"
               (provider-compat-lib/compat-mismatch? resolved "sk-proj-host"))
  (assert-true "pplx live key matches"
               (not (provider-compat-lib/compat-mismatch? resolved "pplx-ok"))))

;; ── BL-1495: b.ai gateway, same shape as the Perplexity coverage above ──────
(assert-true "b.ai host in --openai-api-base"
             (provider-compat-lib/launch-cli-implies-bai?
              "--model openai/glm-5.3-flash --openai-api-base https://api.b.ai/v1"))
(assert-true "plain openai base is not b.ai"
             (not (provider-compat-lib/launch-cli-implies-bai?
                   "--model gpt-4o --openai-api-base https://api.openai.com/v1")))
(assert-true "nil cli is safe (b.ai)"
             (not (provider-compat-lib/launch-cli-implies-bai? nil)))

(let [r (provider-compat-lib/resolve-openai-compat
         {:use-bai false
          :bai-api-key "bai-secret"
          :openai-api-key "sk-proj-host"
          :launch-cli "--openai-api-base https://api.b.ai/v1"})]
  (assert= "CLI→b.ai key wins over host OPENAI"
           "bai-secret" (:openai-api-key r))
  (assert= "provider bai" :bai (:provider r))
  (assert= "reason launch-cli-bai" :launch-cli-bai (:reason r))
  (assert= "base" "https://api.b.ai/v1" (:openai-api-base r)))

(let [r (provider-compat-lib/resolve-openai-compat
         {:use-bai "1"
          :bai-api-key ""
          :openai-api-key "sk-proj-host"
          :launch-cli ""})]
  (assert= "missing b.ai key is explicit"
           :bai-key-missing (:reason r))
  (assert= "a missing key never falls back to the host OPENAI_API_KEY"
           nil (:openai-api-key r)))

(let [r (provider-compat-lib/resolve-openai-compat
         {:use-bai "1"
          :bai-api-key "bai-secret"
          :openai-api-key "sk-proj-host"
          :launch-cli ""})]
  (assert= "flag alone (no host match) still remaps, reason use-bai-flag"
           :use-bai-flag (:reason r)))

;; ── BL-1495 hardener: compat-mismatch? covers b.ai the same way it covers
;;    perplexity/qwen for a missing key, but deliberately has NO family-
;;    comparison branch for a present key (no confirmed b.ai key prefix) ────
(let [resolved (provider-compat-lib/resolve-openai-compat
                {:use-bai "1"
                 :bai-api-key ""
                 :openai-api-key "sk-proj-host"
                 :launch-cli ""})]
  (assert-true "a missing b.ai key is reported as a mismatch"
               (provider-compat-lib/compat-mismatch? resolved "")))

(let [resolved (provider-compat-lib/resolve-openai-compat
                {:launch-cli "--openai-api-base https://api.b.ai/v1"
                 :bai-api-key "bai-secret"
                 :openai-api-key "sk-proj-host"})]
  (assert-true "a correctly-authenticated b.ai pane is never a false-positive mismatch"
               (not (provider-compat-lib/compat-mismatch? resolved "bai-secret"))))

;; ── auth error text ─────────────────────────────────────────────────────────
(assert-true "AuthenticationError classified"
             (provider-compat-lib/provider-auth-error-text?
              "litellm.AuthenticationError: Invalid API key provided."))
(assert-true "benign text not auth"
             (not (provider-compat-lib/provider-auth-error-text?
                   "Tokens: 16k sent, 44 received.")))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println (str "provider_compat_lib_test_runner: " 31 " assertions ok"))
