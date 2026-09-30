#!/usr/bin/env bb
;; BL-1838: TDD runner for local_model_qwen_provider_lib.bb's pure
;; provider-entry/merge-provider-entry functions. The IO (served-window's
;; curl, reading/writing settings-file, the CLI's own arg parsing) is
;; covered by test_bl1829_local_model_qwen_settings.sh and the acceptance
;; feature; this file is the merge shape alone.
(ns local-model-qwen-provider-lib-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "local_model_qwen_provider_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true* [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; ── provider-entry ────────────────────────────────────────────────────────
(let [entry (local-model-qwen-provider-lib/provider-entry "ista-iq3s-coder:latest" "http://127.0.0.1:11434/v1" 49152)]
  (assert= "provider-entry :id" "ista-iq3s-coder:latest" (:id entry))
  (assert= "provider-entry :baseUrl is the given loopback endpoint" "http://127.0.0.1:11434/v1" (:baseUrl entry))
  (assert= "provider-entry :envKey is OLLAMA_API_KEY" "OLLAMA_API_KEY" (:envKey entry))
  (assert= "provider-entry contextWindowSize is the given window" 49152 (get-in entry [:generationConfig :contextWindowSize]))
  (assert= "provider-entry keeps thinking off" false (get-in entry [:generationConfig :extra_body :think])))

;; two different windows for the SAME model produce only contextWindowSize
;; differing - the fixed shape (timeout/streamIdleTimeoutMs/maxRetries/
;; samplingParams/think) never varies with the served window.
(let [a (local-model-qwen-provider-lib/provider-entry "m" "http://x/v1" 32768)
      b (local-model-qwen-provider-lib/provider-entry "m" "http://x/v1" 49152)]
  (assert= "generationConfig is identical apart from contextWindowSize"
           (dissoc (:generationConfig a) :contextWindowSize)
           (dissoc (:generationConfig b) :contextWindowSize)))

;; ── merge-provider-entry ──────────────────────────────────────────────────
;; An absent modelProviders.openai array: the entry is appended, every
;; other top-level key (BL-1829's tool lists) passes through untouched.
(let [existing {:coreTools ["a" "b"] :excludeTools ["c"]}
      merged (local-model-qwen-provider-lib/merge-provider-entry existing "m" "http://x/v1" 32768)]
  (assert= "coreTools passes through untouched" ["a" "b"] (:coreTools merged))
  (assert= "excludeTools passes through untouched" ["c"] (:excludeTools merged))
  (assert= "appends the one entry when modelProviders.openai was absent"
           1 (count (get-in merged [:modelProviders :openai])))
  (assert= "the appended entry's id is the given model" "m" (:id (first (get-in merged [:modelProviders :openai])))))

;; A pre-existing entry for a DIFFERENT model is kept; the new one is
;; appended alongside it, never replacing an unrelated id.
(let [existing {:modelProviders {:openai [{:id "other-model" :baseUrl "http://y/v1"}]}}
      merged (local-model-qwen-provider-lib/merge-provider-entry existing "m" "http://x/v1" 32768)
      ids (map :id (get-in merged [:modelProviders :openai]))]
  (assert= "a differently-id'd entry is kept" #{"other-model" "m"} (set ids))
  (assert= "exactly two entries - nothing dropped, nothing duplicated" 2 (count ids)))

;; A pre-existing entry sharing the SAME id is REPLACED (a re-run with a
;; different served window updates the entry rather than accumulating a
;; second copy of the same model).
(let [existing {:modelProviders {:openai [{:id "m" :baseUrl "http://stale/v1"
                                            :generationConfig {:contextWindowSize 1}}]}}
      merged (local-model-qwen-provider-lib/merge-provider-entry existing "m" "http://x/v1" 49152)
      entries (get-in merged [:modelProviders :openai])]
  (assert= "the stale entry is replaced, not duplicated" 1 (count entries))
  (assert= "the replaced entry carries the NEW window" 49152 (get-in (first entries) [:generationConfig :contextWindowSize]))
  (assert= "the replaced entry carries the NEW baseUrl" "http://x/v1" (:baseUrl (first entries))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
