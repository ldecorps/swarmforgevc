#!/usr/bin/env bb
;; TDD/wiring runner for pre_qa_gate_gather_lib.bb's BL-761 addition:
;; gather-acceptance-contract-facts. Unlike pre_qa_gate_lib_test_runner.bb
;; (pure, no git/fs), this function DOES real git/fs/require work - it is
;; tested against real throwaway git repo fixtures, in the idiom
;; bl531PreQaDurabilityWiringGateSteps.js already uses for swarm_handoff.bb
;; end-to-end coverage, rather than mocked.
;;
;; Each fixture repo commits its OWN small specs/pipeline (stepRegistry.js
;; and runtime.js copied verbatim from this checkout's real files, so the
;; real matching logic runs; steps/index.js is caller-supplied per test) and
;; its own feature file. The vendored APS parser and this checkout's own
;; specs/pipeline/scripts/resolve_contract_steps.js are made reachable on
;; disk (symlink / copy, untracked) rather than committed - they are the
;; STABLE TOOLING the gate always uses, live, never pinned to a cited
;; commit, exactly like the real gather code treats them.

(ns pre-qa-gate-gather-lib-acceptance-contract-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def repo-root (str (-> *file* fs/canonicalize fs/parent fs/parent fs/parent fs/parent)))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "pre_qa_gate_gather_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual (swap! failures conj (str "FAIL: " msg "\n  expected truthy, got: " (pr-str actual)))))

(defn assert-false [msg actual]
  (when actual (swap! failures conj (str "FAIL: " msg "\n  expected falsy, got: " (pr-str actual)))))

;; ── fixture repo construction ────────────────────────────────────────────

(defn- git! [dir & args]
  (let [res (apply process/sh {:dir dir :continue true} "git" args)]
    (when-not (zero? (:exit res))
      (throw (ex-info (str "git " (str/join " " args) " failed: " (:err res)) {:res res})))
    res))

(defn- git-out [dir & args]
  (str/trim (:out (apply git! dir args))))

(defn- write-file! [path content]
  (fs/create-dirs (fs/parent (fs/path path)))
  (spit (str path) content))

(defn- mk-fixture-repo!
  "Builds a throwaway git repo, commits a fixture specs/pipeline + feature
   file, and returns {:root :cited-commit}. `mutate-after!` (optional), when
   given, receives the repo root AFTER the cited commit and can add further
   commits - the caller keeps citing the EARLIER sha, proving the gate reads
   the cited commit, never the working tree tip."
  [{:keys [steps-index-js feature-text feature-path mutate-after! skip-vendor?]
    :or {feature-path "specs/features/fixture.feature"}}]
  (let [root (str (fs/create-temp-dir {:prefix "aps-gather-acceptance-contract-"}))]
    (git! root "init" "-q")
    (write-file! (fs/path root "specs" "pipeline" "stepRegistry.js")
                 (slurp (str (fs/path repo-root "specs" "pipeline" "stepRegistry.js"))))
    (write-file! (fs/path root "specs" "pipeline" "runtime.js")
                 (slurp (str (fs/path repo-root "specs" "pipeline" "runtime.js"))))
    (write-file! (fs/path root "specs" "pipeline" "steps" "index.js") steps-index-js)
    (when feature-text
      (write-file! (fs/path root feature-path) feature-text))
    (when-not skip-vendor?
      (fs/create-dirs (fs/path root "swarmforge" "vendor"))
      (fs/create-sym-link (fs/path root "swarmforge" "vendor" "aps")
                           (fs/canonicalize (fs/path repo-root "swarmforge" "vendor" "aps"))))
    (fs/create-dirs (fs/path root "specs" "pipeline" "scripts"))
    (fs/copy (fs/path repo-root "specs" "pipeline" "scripts" "resolve_contract_steps.js")
             (fs/path root "specs" "pipeline" "scripts" "resolve_contract_steps.js"))
    (git! root "add" "-A")
    (git! root "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "fixture contract")
    (let [cited-commit (git-out root "rev-parse" "--short=10" "HEAD")]
      (when mutate-after! (mutate-after! root))
      {:root root :cited-commit cited-commit})))

(def ^:private one-known-step-registry
  "'use strict';\nfunction registerSteps(registry) { registry.define(/^a known step$/, () => {}); }\nmodule.exports = { registerSteps };\n")

(def ^:private one-outline-step-registry
  "'use strict';\nfunction registerSteps(registry) { registry.define(/^a widget named ok$/, () => {}); }\nmodule.exports = { registerSteps };\n")

;; ── declaration-readable? ────────────────────────────────────────────────

(let [{:keys [root cited-commit]}
      (mk-fixture-repo! {:steps-index-js one-known-step-registry
                          :feature-text "Feature: fixture\n  Scenario: ok\n    Given a known step\n"})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
  (assert-true "a resolvable feature file -> declaration readable" (:declaration-readable? facts))
  (assert-true "a resolvable feature file -> registry loadable" (:registry-loadable? facts))
  (assert= "every step resolves -> no unresolved steps" [] (:unresolved-steps facts)))

(let [{:keys [root cited-commit]}
      (mk-fixture-repo! {:steps-index-js one-known-step-registry :feature-text nil})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\n")]
  (assert-false "no acceptance: field -> declaration unreadable" (:declaration-readable? facts)))

(let [{:keys [root cited-commit]}
      (mk-fixture-repo! {:steps-index-js one-known-step-registry :feature-text nil})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/does-not-exist.feature\n")]
  (assert-false "acceptance: names a file missing at the cited commit -> declaration unreadable" (:declaration-readable? facts)))

(let [{:keys [root cited-commit]}
      (mk-fixture-repo! {:steps-index-js one-known-step-registry :feature-text nil})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: |\n  Feature: inline\n    Scenario: x\n      Given a known step\n")]
  (assert-false "inline Gherkin (block scalar) instead of a path -> declaration unreadable" (:declaration-readable? facts)))

;; ── unresolved steps ─────────────────────────────────────────────────────

(let [{:keys [root cited-commit]}
      (mk-fixture-repo! {:steps-index-js one-known-step-registry
                          :feature-text "Feature: fixture\n  Scenario: broken\n    Given an unknown step\n"})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
  (assert-true "registry still loadable even with an unresolved step" (:registry-loadable? facts))
  (assert= "one unresolved step is reported with its scenario and step text"
           [{:scenario "broken" :example-index nil :step-text "an unknown step"}]
           (:unresolved-steps facts)))

;; a Scenario Outline row that stops resolving after substitution - the
;; example-index survives the round trip through resolve_contract_steps.js.
(let [{:keys [root cited-commit]}
      (mk-fixture-repo!
       {:steps-index-js one-outline-step-registry
        :feature-text (str "Feature: fixture\n"
                            "  Scenario Outline: outline\n"
                            "    Given a widget named <name>\n\n"
                            "    Examples:\n"
                            "      | name  |\n"
                            "      | ok    |\n"
                            "      | not-ok |\n")})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
  (assert= "the second example row (index 1) is the one that fails to resolve"
           [{:scenario "outline" :example-index 1 :step-text "a widget named not-ok"}]
           (:unresolved-steps facts)))

;; ── judged at the cited commit, not the working tree tip ────────────────

(let [{:keys [root cited-commit]}
      (mk-fixture-repo!
       {:steps-index-js one-known-step-registry
        :feature-text "Feature: fixture\n  Scenario: ok\n    Given a known step\n"
        :mutate-after!
        (fn [root]
          (write-file! (fs/path root "specs" "pipeline" "steps" "index.js")
                       "'use strict';\nfunction registerSteps(){ }\nmodule.exports = { registerSteps };\n")
          (git! root "add" "-A")
          (git! root "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "later commit deletes the handler"))})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
  (assert= "a handler deleted AFTER the cited commit does not affect the verdict at that commit"
           [] (:unresolved-steps facts)))

;; ── registry unloadable -> fails open ────────────────────────────────────

(let [{:keys [root cited-commit]}
      (mk-fixture-repo! {:steps-index-js "'use strict';\nthrow new Error('boom - simulated broken require');\n"
                          :feature-text "Feature: fixture\n  Scenario: ok\n    Given a known step\n"})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
  (assert-true "declaration is still readable (the feature file itself was fine)" (:declaration-readable? facts))
  (assert-false "a step registry that throws on require is not loadable" (:registry-loadable? facts))
  (assert-true "the load error names the underlying reason"
               (and (:registry-load-error facts) (re-find #"boom - simulated broken require" (:registry-load-error facts)))))

;; a fixture/checkout with no vendored APS parser tool at all (e.g. a test
;; fixture never set up for acceptance-contract checking, like BL-531's own
;; wiring-gate fixtures) must fail OPEN - this is infrastructure trouble,
;; never the ticket's fault - not be mistaken for an unreadable declaration.
(let [{:keys [root cited-commit]}
      (mk-fixture-repo! {:steps-index-js one-known-step-registry
                          :feature-text "Feature: fixture\n  Scenario: ok\n    Given a known step\n"
                          :skip-vendor? true})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
  (assert-true "a missing vendor parser tool still leaves the declaration readable" (:declaration-readable? facts))
  (assert-false "a missing vendor parser tool is not loadable" (:registry-loadable? facts))
  (assert-true "the load error names the missing vendor tool, not the declaration"
               (and (:registry-load-error facts) (re-find #"vendor" (:registry-load-error facts)))))

;; ── end to end through evaluate ──────────────────────────────────────────

(let [{:keys [root cited-commit]}
      (mk-fixture-repo! {:steps-index-js one-known-step-registry
                          :feature-text "Feature: fixture\n  Scenario: broken\n    Given an unknown step\n"})
      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")
      result (acceptance-contract-gate-lib/evaluate (assoc facts :ticket-id "BL-999"))]
  (assert= "the gathered facts, fed through evaluate, produce exactly one finding"
           1 (count (:findings result)))
  (assert= "the finding's class is :acceptance-contract"
           :acceptance-contract (:class (first (:findings result)))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: pre_qa_gate_gather_lib.bb (acceptance-contract)"))
