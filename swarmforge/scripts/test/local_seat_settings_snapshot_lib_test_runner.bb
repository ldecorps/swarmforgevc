#!/usr/bin/env bb
;; BL-1850: unit tests for the pure half of the local-model seat settings
;; snapshot (local_seat_settings_snapshot_lib.bb): Ollama's parameters text,
;; the provider entry qwen will use, credential dropping, nvidia-smi's line,
;; and the fingerprint.
(ns local-seat-settings-snapshot-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "local_seat_settings_snapshot_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def lib-ns 'local-seat-settings-snapshot-lib)
(defn f [sym] (ns-resolve lib-ns sym))

;; ── Ollama /api/show parameters ──────────────────────────────────────────
(assert= "numbers parse, quoted strings unquote, a repeated key becomes a vector"
         {"num_ctx" 49152 "num_predict" 4096 "temperature" 0.3 "stop" ["<|im_start|>" "<|im_end|>"]}
         ((f 'parse-show-parameters)
          "num_ctx                        49152\nnum_predict                    4096\ntemperature                    0.3\nstop                           \"<|im_start|>\"\nstop                           \"<|im_end|>\"\n"))
(assert= "blank or missing parameters parse to an empty map" {} ((f 'parse-show-parameters) nil))
(assert= "a value with spaces keeps them" {"system" "be brief please"} ((f 'parse-show-parameters) "system \"be brief please\""))

;; ── the provider entry qwen will use ─────────────────────────────────────
(def user-settings {:modelProviders {:openai [{:id "m" :name "user"} {:id "other"}]}})
(def ws-settings {:modelProviders {:openai [{:id "m" :name "workspace"}]}})
(assert= "the seat worktree's list replaces the user list when it carries one"
         {:id "m" :name "workspace"}
         ((f 'pick-provider-entry) {:workspace ws-settings :user user-settings :model "m"}))
(assert= "with no workspace list, the user list's entry for the model"
         {:id "m" :name "user"}
         ((f 'pick-provider-entry) {:workspace {:coreTools ["x"]} :user user-settings :model "m"}))
(assert= "a workspace list without the model is still the list qwen uses: no entry"
         nil
         ((f 'pick-provider-entry) {:workspace {:modelProviders {:openai [{:id "other"}]}} :user user-settings :model "m"}))
(assert= "no settings at all: no entry" nil ((f 'pick-provider-entry) {:workspace nil :user nil :model "m"}))

;; ── credentials never reach the record ───────────────────────────────────
(assert= "apiKey and every key naming a token, secret or password are dropped, at any depth"
         {:id "m" :envKey "OLLAMA_API_KEY" :generationConfig {:contextWindowSize 1 :extra_body {:think false}} :headers {:x 1}}
         ((f 'drop-credentials)
          {:id "m" :apiKey "sk-1" :envKey "OLLAMA_API_KEY"
           :generationConfig {:contextWindowSize 1 :extra_body {:think false} :accessToken "t"}
           :headers {:x 1 :Authorization-Secret "s" :password "p" :refresh_token "r"}}))
(assert= "a key that merely contains an API-key name is a credential too (found by the BL-1850 property)"
         {:timeout0 1} ((f 'drop-credentials) {:timeoutApiKey "sk" :timeout0 1 :OPENAI_API_KEY "sk" :x-api-key "sk"}))
(assert= "a credential inside a list element is dropped too"
         [{:id 1}] ((f 'drop-credentials) [{:id 1 :ApiKey "x"}]))

;; ── nvidia-smi ───────────────────────────────────────────────────────────
(assert= "name, enforced and default power limits in watts"
         {:name "NVIDIA GeForce RTX 4070" :powerLimitW 150.0 :defaultPowerLimitW 180.0}
         ((f 'parse-nvidia-smi) "NVIDIA GeForce RTX 4070, 150.00 W, 180.00 W\n"))
(assert= "an unparseable line is unknown" nil ((f 'parse-nvidia-smi) "garbage"))
(assert= "the first GPU's line when there are several"
         {:name "A" :powerLimitW 100.0 :defaultPowerLimitW 120.0}
         ((f 'parse-nvidia-smi) "A, 100.00 W, 120.00 W\nB, 200.00 W, 250.00 W\n"))

;; ── fingerprint ──────────────────────────────────────────────────────────
(def row {:at "2026-10-03T00:00:00Z" :seat "coder@iq3" :model "m" :ollama {:version "0.32.15"} :gpu "unknown"})
(assert= "the fingerprint ignores :at"
         ((f 'fingerprint) row) ((f 'fingerprint) (assoc row :at "2027-01-01T00:00:00Z")))
(assert= "the fingerprint ignores key order"
         ((f 'fingerprint) row) ((f 'fingerprint) (into (sorted-map-by (comparator (fn [a b] (pos? (compare (str a) (str b)))))) row)))
(assert= "any setting moves the fingerprint" false (= ((f 'fingerprint) row) ((f 'fingerprint) (assoc-in row [:ollama :version] "0.32.16"))))
(assert= "a fingerprint is a sha256 hex" true (boolean (re-matches #"[0-9a-f]{64}" ((f 'fingerprint) row))))
(assert= "finish-row stamps the fingerprint of the row it returns"
         ((f 'fingerprint) row) (:fingerprint ((f 'finish-row) row)))

(if (seq @failures)
  (do (doseq [x @failures] (println x)) (println (count @failures) "failure(s)") (System/exit 1))
  (println "ALL PASS: local_seat_settings_snapshot_lib.bb"))
