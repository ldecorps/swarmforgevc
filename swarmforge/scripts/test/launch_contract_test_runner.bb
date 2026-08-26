#!/usr/bin/env bb
;; TDD runner for launch_contract_lib.bb (BL-530) - pure assertions over
;; provided conf text, mirroring coordinator_config_test_runner.bb's own shape.
(ns launch-contract-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "launch_contract_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── launch-contract-01: a default (claude) coordinator never opts in ───────

(assert= "launch-contract-01: no coordinator_agent line at all never requires the explicit contract"
         false
         (launch-contract-lib/requires-explicit-launch-contract? "config active_backlog_max_depth 3"))

(assert= "launch-contract-01: an explicit coordinator_agent claude never requires the explicit contract"
         false
         (launch-contract-lib/requires-explicit-launch-contract? "config coordinator_agent claude"))

(assert= "launch-contract-01: a classic (non-mono-router) pack with neither line reports zero violations"
         []
         (launch-contract-lib/launch-contract-violations "config active_backlog_max_depth 3"))

;; ── launch-contract-02: a non-default coordinator_agent opts in ────────────

(assert= "launch-contract-02: coordinator_agent aider requires the explicit contract"
         true
         (launch-contract-lib/requires-explicit-launch-contract? "config coordinator_agent aider"))

;; ── launch-contract-03: missing coordinator_model is flagged only when
;;    the pack opted in ─────────────────────────────────────────────────────

(assert= "launch-contract-03: coordinator_agent aider with no coordinator_model line is missing"
         true
         (launch-contract-lib/missing-coordinator-model? "config coordinator_agent aider"))

(assert= "launch-contract-03: coordinator_agent aider WITH a coordinator_model line is not missing"
         false
         (launch-contract-lib/missing-coordinator-model?
          "config coordinator_agent aider\nconfig coordinator_model openai/gpt-oss-120b"))

(assert= "launch-contract-03: no coordinator_agent line at all never flags coordinator_model as missing"
         false
         (launch-contract-lib/missing-coordinator-model? "config active_backlog_max_depth 3"))

;; ── launch-contract-04: missing rotation is flagged only when the pack
;;    opted in ──────────────────────────────────────────────────────────────

(assert= "launch-contract-04: coordinator_agent aider with no rotation line is missing"
         true
         (launch-contract-lib/missing-rotation? "config coordinator_agent aider"))

(assert= "launch-contract-04: coordinator_agent aider WITH a rotation line is not missing"
         false
         (launch-contract-lib/missing-rotation?
          "config coordinator_agent aider\nconfig rotation router"))

(assert= "launch-contract-04: no coordinator_agent line at all never flags rotation as missing"
         false
         (launch-contract-lib/missing-rotation? "config rotation router"))

;; ── launch-contract-05: launch-contract-violations names every missing
;;    field, empty when the contract is complete ────────────────────────────

(assert= "launch-contract-05: both coordinator_model and rotation missing are both reported"
         ["coordinator_model" "rotation"]
         (map :field (launch-contract-lib/launch-contract-violations "config coordinator_agent aider")))

(assert= "launch-contract-05: only rotation missing reports only rotation"
         ["rotation"]
         (map :field (launch-contract-lib/launch-contract-violations
                       "config coordinator_agent aider\nconfig coordinator_model openai/gpt-oss-120b")))

(assert= "launch-contract-05: only coordinator_model missing reports only coordinator_model"
         ["coordinator_model"]
         (map :field (launch-contract-lib/launch-contract-violations
                       "config coordinator_agent aider\nconfig rotation router")))

(assert= "launch-contract-05: a fully-declared pack has zero violations"
         []
         (launch-contract-lib/launch-contract-violations
          "config coordinator_agent aider\nconfig coordinator_model openai/gpt-oss-120b\nconfig rotation router"))

(assert= "launch-contract-05: a violation names the offending coordinator_agent value in its detail"
         true
         (clojure.string/includes?
          (:detail (first (launch-contract-lib/launch-contract-violations "config coordinator_agent aider")))
          "aider"))

;; ── launch-contract-06: real fixture regression - the actual shipped
;;    packs, read from disk, reproduce (or clear) the BL-512 finding ────────

(def packs-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." "packs")))

(defn slurp-pack [name]
  (slurp (str (fs/path packs-dir (str name ".conf")))))

(assert= "launch-contract-06: cerebras-mono-router.conf is the known-broken pack (BL-512) - coordinator_model missing"
         ["coordinator_model"]
         (map :field (launch-contract-lib/launch-contract-violations (slurp-pack "cerebras-mono-router"))))

(doseq [compliant-pack ["codex-mono-router" "gemini-mono-router" "perplexity-mono-router"
                        "qwen-mono-router" "vibe-mono-router"]]
  (assert= (str "launch-contract-06: " compliant-pack ".conf already declares its full contract - zero violations")
           []
           (launch-contract-lib/launch-contract-violations (slurp-pack compliant-pack))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: launch_contract_lib.bb"))
