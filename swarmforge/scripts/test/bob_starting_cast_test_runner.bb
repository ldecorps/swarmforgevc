#!/usr/bin/env bb
;; BL-1181 TDD runner for bob_starting_cast_lib.bb
(ns bob-starting-cast-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))
(load-file (str (fs/path scripts-dir "bob_starting_cast_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(def empty-registry model-steward-lib/empty-registry)

(defn reg-with-per-role-top [role->model]
  (reduce-kv
   (fn [reg role [provider model]]
     (-> reg
         (model-steward-lib/register-model provider model {:status "certified" :cost_class "medium"})
         (model-steward-lib/add-role-ranking role provider model 0.9 "battery fixture")))
   empty-registry
   role->model))

;; 01: one model per role
(let [reg (reg-with-per-role-top {"coder" ["anthropic" "claude-sonnet-5"]
                                  "architect" ["openai" "gpt-5.3-codex"]})
      cast (bob-starting-cast-lib/export-bob-starting-cast reg ["coder" "architect"])]
  (assert= "01: cast names exactly one entry per requested role"
           #{"coder" "architect"} (set (keys (:roles cast))))
  (assert-true "01: each role names provider and model"
               (every? #(and (:provider %) (:model %)) (vals (:roles cast)))))

;; 02: mixed vendors allowed
(let [reg (reg-with-per-role-top {"coder" ["anthropic" "claude-sonnet-5"]
                                  "QA" ["cerebras" "llama-3.3-70b"]})
      cast (bob-starting-cast-lib/export-bob-starting-cast reg ["coder" "QA"])]
  (assert-true "02: mixed vendors across roles"
               (> (count (bob-starting-cast-lib/distinct-providers cast)) 1)))

;; 03: apply reuses ModelFactory overlay path
(let [cast {:kind "bob-starting-cast" :schema-version 1
            :roles {"coder" {:role "coder" :agent "claude" :provider "anthropic"
                             :model "claude-opus-4-8" :policy "bob-starting-cast" :reason "x"}}}
      plan (bob-starting-cast-lib/apply-via-modelfactory-overlay cast)]
  (assert= "03: apply via model-factory overlay" "model-factory-overlay" (:via plan))
  (assert= "03: overlay assignment shape" "claude-opus-4-8" (get-in plan [:assignment :coder :model])))

;; 04: model-change detection
(let [cast {:kind "bob-starting-cast" :schema-version 1
            :roles {"coder" {:role "coder" :model "claude-opus-4-8"}}}
      current {:coder {:model "claude-sonnet-5"}}]
  (assert= "04: detects model change for role" ["coder"]
           (bob-starting-cast-lib/roles-with-model-change cast current)))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))
(println "ALL PASS: bob_starting_cast_lib.bb")
