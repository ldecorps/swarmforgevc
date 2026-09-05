#!/usr/bin/env bb
;; TDD runner for contract_freshness_gate_lib.bb (BL-1411) - the send-time
;; gate that refuses a git_handoff whose ticket's acceptance feature file
;; was amended on main (or origin/main) since the sender's merge-base.

(ns contract-freshness-gate-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "contract_freshness_gate_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))
(defn assert-excludes [msg haystack needle]
  (when (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to EXCLUDE: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── decide-for-ref: pure branching, invariant 3's fail-open shape ───────────

(assert= "an unresolved ref is not-evaluated, never refused"
         {:action :not-evaluated :ref "origin/main" :reason "ref origin/main does not resolve"}
         (contract-freshness-gate-lib/decide-for-ref
          {:ref "origin/main" :ref-exists? false :base "abc" :path-exists-on-ref? true :differs? true}))

(assert= "no merge-base is not-evaluated, never refused"
         {:action :not-evaluated :ref "main" :reason "no merge-base with main"}
         (contract-freshness-gate-lib/decide-for-ref
          {:ref "main" :ref-exists? true :base nil :path-exists-on-ref? true :differs? true}))

(assert= "an absent path on the ref is not-evaluated, never refused"
         {:action :not-evaluated :ref "main" :reason "the acceptance path is absent on main"}
         (contract-freshness-gate-lib/decide-for-ref
          {:ref "main" :ref-exists? true :base "abc" :path-exists-on-ref? false :differs? true}))

(assert= "an unreadable diff is not-evaluated, never refused"
         {:action :not-evaluated :ref "main" :reason "the diff against main could not be read"}
         (contract-freshness-gate-lib/decide-for-ref
          {:ref "main" :ref-exists? true :base "abc" :path-exists-on-ref? true :differs? nil}))

(assert= "a real difference refuses, carrying the base and the amending commits"
         {:action :refuse :ref "main" :base "abc" :amending-commits ["def1234"]}
         (contract-freshness-gate-lib/decide-for-ref
          {:ref "main" :ref-exists? true :base "abc" :path-exists-on-ref? true :differs? true
           :amending-commits ["def1234"]}))

(assert= "no difference is clean"
         {:action :clean :ref "main"}
         (contract-freshness-gate-lib/decide-for-ref
          {:ref "main" :ref-exists? true :base "abc" :path-exists-on-ref? true :differs? false}))

;; Precedence: the earliest fail-open reason in the cond wins even when a
;; later fact is also missing - each branch is independently reachable, and
;; a caller must be able to trust the FIRST reason it is given.
(assert= "ref-exists? false wins over every other missing fact"
         {:action :not-evaluated :ref "main" :reason "ref main does not resolve"}
         (contract-freshness-gate-lib/decide-for-ref
          {:ref "main" :ref-exists? false :base nil :path-exists-on-ref? false :differs? nil}))

;; ── blocked? ─────────────────────────────────────────────────────────────

(assert-true "non-empty findings -> blocked"
             (contract-freshness-gate-lib/blocked? {:findings [{:path "a" :ref "main" :amending-commits ["x"]}]}))
(assert-false "empty findings -> not blocked"
              (contract-freshness-gate-lib/blocked? {:findings []}))
(assert-false "nil findings -> not blocked"
              (contract-freshness-gate-lib/blocked? {:findings nil}))

;; ── refusal-message ──────────────────────────────────────────────────────

(let [msg (contract-freshness-gate-lib/refusal-message
           {:task-name "BL-9001-fixture"
            :findings [{:path "specs/features/BL-9001-fixture.feature" :ref "main"
                        :amending-commits ["deadbee123"]}]})]
  (assert-includes "refusal opens with the marker" msg "CONTRACT_AMENDED_SINCE_BASE for BL-9001-fixture")
  (assert-includes "refusal states not-queued" msg "HANDOFF_NOT_QUEUED")
  (assert-includes "refusal names the path" msg "specs/features/BL-9001-fixture.feature")
  (assert-includes "refusal names the ref" msg "main")
  (assert-includes "refusal names the amending commit" msg "deadbee123")
  (assert-includes "refusal states the remedy" msg "merge main"))

(let [msg (contract-freshness-gate-lib/refusal-message
           {:task-name "BL-9001-fixture"
            :findings [{:path "specs/features/BL-9001-fixture.feature" :ref "main" :amending-commits ["aaa1111"]}
                       {:path "specs/features/BL-9001-fixture.feature" :ref "origin/main" :amending-commits ["bbb2222"]}]})]
  (assert-includes "multi-ref refusal names main's amending commit" msg "aaa1111")
  (assert-includes "multi-ref refusal names origin/main's amending commit" msg "bbb2222")
  (assert-includes "multi-ref refusal names main" msg "main")
  (assert-includes "multi-ref refusal names origin/main" msg "origin/main"))

;; ── findings-for-git-handoff: real git fixture ──────────────────────────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1411-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(defn- write! [root path content]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content))

(defn- commit! [root message]
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- rev [root] (:out (sh! root "git" "rev-parse" "HEAD")))

(defn- ticket-yaml [feature-path]
  (str "id: BL-9001\nacceptance: " feature-path "\n"))

(defn- feature-text [n]
  (str "Feature: fixture\n  Scenario: " n "\n    Given a\n"))

;; Scenario: unchanged since the base -> no findings.
(with-fixture [root]
  (write! root "backlog/active/BL-9001-fixture.yaml" (ticket-yaml "specs/features/BL-9001-fixture.feature"))
  (write! root "specs/features/BL-9001-fixture.feature" (feature-text 1))
  (commit! root "base")
  (let [commit (rev root)
        result (contract-freshness-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-9001-fixture" :commit commit})]
    (assert= "unchanged contract yields no findings" [] (:findings result))
    (assert= "unchanged contract yields no not-evaluated entries" [] (:not-evaluated result))))

;; Scenario: main amends the feature file after the sender's base -> refused,
;; naming the amending commit.
(with-fixture [root]
  (write! root "backlog/active/BL-9001-fixture.yaml" (ticket-yaml "specs/features/BL-9001-fixture.feature"))
  (write! root "specs/features/BL-9001-fixture.feature" (feature-text 1))
  (commit! root "base")
  (let [base-commit (rev root)]
    (write! root "specs/features/BL-9001-fixture.feature" (feature-text 2))
    (commit! root "amend on main")
    (let [amending-commit (rev root)
          result (contract-freshness-gate-lib/findings-for-git-handoff
                  {:root root :task-name "BL-9001-fixture" :commit base-commit})]
      (assert= "an amendment on main is exactly one finding" 1 (count (:findings result)))
      (assert= "the finding names the declared path"
               "specs/features/BL-9001-fixture.feature" (:path (first (:findings result))))
      (assert= "the finding names main as the ref" "main" (:ref (first (:findings result))))
      (assert-true "the finding names the amending commit"
                   (some #(str/starts-with? amending-commit %) (:amending-commits (first (:findings result))))))))

;; Scenario: the sender's own later commit rewrites the SAME path - the gate
;; compares main against the BASE, never the parcel tip, so a commit cited
;; after the sender's own edit is unaffected by that edit.
(with-fixture [root]
  (write! root "backlog/active/BL-9001-fixture.yaml" (ticket-yaml "specs/features/BL-9001-fixture.feature"))
  (write! root "specs/features/BL-9001-fixture.feature" (feature-text 1))
  (commit! root "base")
  (write! root "specs/features/BL-9001-fixture.feature" (feature-text "1 (sender's own rewrite)"))
  (commit! root "sender's own rewrite")
  (let [commit (rev root)
        result (contract-freshness-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-9001-fixture" :commit commit})]
    (assert= "the sender's own rewrite of its own path is never a finding" [] (:findings result))))

;; Scenario: the ticket's own path is absent on main -> not-evaluated, and the
;; gate NEVER refuses on an unreadable contract.
(with-fixture [root]
  (write! root "backlog/active/BL-9001-fixture.yaml" (ticket-yaml "specs/features/BL-9001-fixture.feature"))
  (commit! root "base, no feature file")
  (let [commit (rev root)
        result (contract-freshness-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-9001-fixture" :commit commit})]
    (assert= "an absent path yields no findings" [] (:findings result))
    (assert= "an absent path is reported as not-evaluated" 1 (count (:not-evaluated result)))
    (assert-includes "the not-evaluated entry names the reason"
                      (first (:not-evaluated result)) "is absent on main")))

;; Scenario: no ticket YAML at all -> a warning, never a refusal, mirroring
;; the sibling gates' own {:warning ...} contract exactly.
(with-fixture [root]
  (commit! root "base, no ticket at all")
  (let [commit (rev root)
        result (contract-freshness-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-9001-fixture" :commit commit})]
    (assert-true "an unreadable ticket yields a warning, not findings"
                 (some? (:warning result)))
    (assert= "an unreadable ticket carries no :findings key at all" nil (:findings result))))

;; Scenario: the task name resolves to no ticket id at all -> no findings,
;; the caller's own fail-open, never a git call at all.
(with-fixture [root]
  (commit! root "seed" )
  (let [commit (rev root)
        result (contract-freshness-gate-lib/findings-for-git-handoff
                {:root root :task-name "a-task-with-no-ticket-id" :commit commit})]
    (assert= "no ticket id in the task name yields no findings" [] (:findings result))))

;; Scenario: a ticket with no declared acceptance path -> no findings, never
;; a spurious not-evaluated entry either (there is nothing to check).
(with-fixture [root]
  (write! root "backlog/active/BL-9001-fixture.yaml" "id: BL-9001\n")
  (commit! root "base, no acceptance: declared")
  (let [commit (rev root)
        result (contract-freshness-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-9001-fixture" :commit commit})]
    (assert= "no declared acceptance path yields no findings" [] (:findings result))
    (assert= "no declared acceptance path is not reported as not-evaluated"
             nil (:not-evaluated result))))

;; ── report ───────────────────────────────────────────────────────────────

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str "\n" (count @failures) " FAILURE(S)"))
    (System/exit 1))
  (println "ALL PASS"))
