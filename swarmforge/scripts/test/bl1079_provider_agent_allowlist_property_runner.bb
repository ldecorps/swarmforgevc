#!/usr/bin/env bb
;; BL-1079 scenario 04 / cross-boundary agreement: the agent token
;; ModelFactory derives for provider "cursor" must appear in the shell
;; launcher's validate_agent allow-list, and the two literals are compared
;; rather than restated in a comment beside either source.
;;
;; Reads model_factory_lib.bb's provider->agent and the REAL validate_agent
;; function body from swarmforge.sh — never a JS/bb copy of the allow-list.
(ns bl1079-provider-agent-allowlist-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn launcher-allow-list-tokens
  "Tokens named in swarmforge.sh's validate_agent case arm — the ONE
   allow-list BL-1078 widened. Empty/unparseable is a hard fail, never an
   empty-set false pass."
  []
  (let [src (slurp (str (fs/path scripts-dir "swarmforge.sh")))
        fn-body (second (re-find #"(?m)^(validate_agent\(\) \{[\s\S]*?^\})" src))
        alts (when fn-body
               (second (re-find #"(?m)^\s+([a-z0-9_|]+)\)\s*;;\s*$" fn-body)))]
    (when-not fn-body
      (swap! failures conj "FAIL: validate_agent could not be located in swarmforge.sh"))
    (when (and fn-body (str/blank? alts))
      (swap! failures conj "FAIL: validate_agent case arm with agent tokens was not found"))
    (when (and fn-body (not (str/blank? alts)))
      (assert-true "validate_agent names a refusal for unsupported agents"
                   (str/includes? fn-body "Unsupported agent")))
    (into #{} (remove str/blank? (str/split (or alts "") #"\|")))))

(def derived-token (model-factory-lib/agent-for-provider "cursor"))
(def allow-list (launcher-allow-list-tokens))

(assert= "ModelFactory derives the cursor agent token for provider cursor"
         "cursor" derived-token)
(assert-true (str "derived token " (pr-str derived-token)
                  " appears in the launcher allow-list " (pr-str allow-list)
                  " — compared as literals, not restated")
             (contains? allow-list derived-token))

(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
