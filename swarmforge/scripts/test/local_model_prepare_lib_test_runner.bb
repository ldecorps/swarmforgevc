#!/usr/bin/env bb
;; Unit tests for local_model_prepare_lib.bb — Modelfile render, alias
;; sanitize, think-off settings, empty-response fail shape. Never talks
;; to a real ollama (dry-run prepare only).
(ns local-model-prepare-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (str (fs/parent (fs/parent (fs/canonicalize *file*)))))
(load-file (str (fs/path scripts-dir "local_model_prepare_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── sanitize-alias ──────────────────────────────────────────────────────
(assert-true "sanitize strips hf.co/ and slashes"
             (str/starts-with? (local-model-prepare-lib/sanitize-alias
                                "hf.co/Org/Repo-Name:Q4_K_M")
                               "prepared-"))
(assert-true "sanitize has no slashes"
             (not (str/includes? (local-model-prepare-lib/sanitize-alias
                                  "hf.co/a/b:c")
                                 "/")))

;; ── render-modelfile ────────────────────────────────────────────────────
(let [body (local-model-prepare-lib/render-modelfile
            {:from "hf.co/example/Model:Q4_K_M"
             :num-ctx 32768
             :num-predict 4096
             :template-text "FROM {{FROM}}\nPARAMETER num_ctx {{NUM_CTX}}\nPARAMETER num_predict {{NUM_PREDICT}}\n"})]
  (assert-true "render keeps FROM line" (str/includes? body "FROM hf.co/example/Model:Q4_K_M"))
  (assert-true "render num_ctx" (str/includes? body "PARAMETER num_ctx 32768"))
  (assert-true "render num_predict" (str/includes? body "PARAMETER num_predict 4096")))

;; ── think-off aider settings cover ollama_chat / openai ids ─────────────
(let [ids (local-model-prepare-lib/aider-model-ids-for "prepared-foo:latest")
      yml (local-model-prepare-lib/think-off-aider-settings ids)]
  (assert-true "ids include raw alias" (some #(= "prepared-foo:latest" %) ids))
  (assert-true "ids include ollama_chat/" (some #(str/starts-with? % "ollama_chat/") ids))
  (assert-true "yml sets think false" (str/includes? yml "think: false"))
  (assert-true "yml sets reasoning_tag" (str/includes? yml "reasoning_tag: think")))

;; ── empty-response fail shape ───────────────────────────────────────────
(assert-true "empty-response shape: 0/5 fast no-commit"
             (local-model-prepare-lib/empty-response-fail-shape?
              {:handedOff 0 :of 5 :verdict "fail"}
              [{:fixtureId "01-one-line-fix" :outcome "no model commit" :wallSeconds 8.0}
               {:fixtureId "02-two-line-two-functions" :outcome "no model commit" :wallSeconds 7.5}]))
(assert-true "empty-response shape: pass is not empty-fail"
             (not (local-model-prepare-lib/empty-response-fail-shape?
                   {:handedOff 5 :of 5 :verdict "pass"}
                   [{:fixtureId "01-one-line-fix" :outcome "handed off" :wallSeconds 120}])))
(assert-true "empty-response shape: slow no-commit is not the XXS shape"
             (not (local-model-prepare-lib/empty-response-fail-shape?
                   {:handedOff 0 :of 1 :verdict "fail"}
                   [{:fixtureId "01-one-line-fix" :outcome "no model commit" :wallSeconds 200}])))

;; ── prepare! dry-run writes artifacts ───────────────────────────────────
(let [tmpdir (str (fs/create-temp-dir {:prefix "prepare-lib-test-"}))
      profile (local-model-prepare-lib/prepare!
               {:base "hf.co/example/Model:Q4_K_M"
                :alias "prepared-test-alias"
                :dry-run? true
                :state-dir tmpdir
                :root (local-model-prepare-lib/repo-root)})]
  (assert= "dry-run alias" "prepared-test-alias" (:alias profile))
  (assert-true "dry-run writes Modelfile" (fs/exists? (:modelfilePath profile)))
  (assert-true "dry-run writes aider settings" (fs/exists? (:aiderSettingsPath profile)))
  (assert-true "dry-run writes profile json" (fs/exists? (:profilePath profile)))
  (assert-true "dry-run Modelfile has FROM" (str/includes? (slurp (:modelfilePath profile)) "FROM hf.co/example/Model:Q4_K_M"))
  (assert-true "dry-run aider settings think false"
               (str/includes? (slurp (:aiderSettingsPath profile)) "think: false"))
  (fs/delete-tree tmpdir))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (do (println "local_model_prepare_lib_test_runner: ALL CHECKS PASSED")
      (System/exit 0)))
