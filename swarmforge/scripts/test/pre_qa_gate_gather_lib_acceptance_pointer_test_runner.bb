#!/usr/bin/env bb
;; TDD/wiring runner for pre_qa_gate_gather_lib.bb's BL-880 addition:
;; gather-acceptance-pointer-facts and pointer-findings-for-git-handoff.
;; Unlike acceptance_pointer_gate_lib_test_runner.bb (pure, no git/fs), these
;; functions DO real git work - tested against real throwaway git repo
;; fixtures, the same idiom pre_qa_gate_gather_lib_acceptance_contract_test_
;; runner.bb already uses for BL-761's gather layer, but far lighter: no
;; vendored parser, no step registry, no specs/pipeline materialization -
;; one git object per probe.

(ns pre-qa-gate-gather-lib-acceptance-pointer-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "pre_qa_gate_gather_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual (swap! failures conj (str "FAIL: " msg "\n  expected truthy, got: " (pr-str actual)))))

(defn assert-false [msg actual]
  (when actual (swap! failures conj (str "FAIL: " msg "\n  expected falsy, got: " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

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
  "A throwaway git repo with one committed file at feature-path (defaults to
   a real feature file, present at the returned :cited-commit). Returns
   {:root :cited-commit}."
  [{:keys [feature-path feature-text]
    :or {feature-path "specs/features/fixture.feature"
         feature-text "Feature: fixture\n  Scenario: ok\n    Given a known step\n"}}]
  (let [root (str (fs/create-temp-dir {:prefix "aps-gather-acceptance-pointer-"}))]
    (swap! created-temp-dirs conj root)
    (git! root "init" "-q")
    (write-file! (fs/path root feature-path) feature-text)
    (git! root "add" "-A")
    (git! root "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "fixture feature")
    {:root root :cited-commit (git-out root "rev-parse" "--short=10" "HEAD")}))

;; corrupts the fixture's OWN tree object (never the commit object, which
;; must keep resolving - canonical-commit already guaranteed that upstream
;; in swarm_handoff.bb before this gate ever runs) so tree-readable? has a
;; real, non-hand-waved false case to probe, distinct from "path missing".
(defn- corrupt-tree-object! [root full-commit-sha]
  (let [tree-sha (git-out root "rev-parse" (str full-commit-sha "^{tree}"))
        obj-file (fs/path root ".git" "objects" (subs tree-sha 0 2) (subs tree-sha 2))]
    (fs/move obj-file (fs/path (str obj-file ".bak")))))

;; ── gather-acceptance-pointer-facts ───────────────────────────────────────

(let [{:keys [root cited-commit]} (mk-fixture-repo! {})
      facts (pre-qa-gate-gather-lib/gather-acceptance-pointer-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
  (assert-true "a resolvable path -> tree readable" (:tree-readable? facts))
  (assert-true "a resolvable path -> path exists" (:path-exists? facts))
  (assert= "the raw declaration is threaded through" "specs/features/fixture.feature" (:raw-declaration facts)))

(let [{:keys [root cited-commit]} (mk-fixture-repo! {})
      facts (pre-qa-gate-gather-lib/gather-acceptance-pointer-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/does-not-exist.feature\n")]
  (assert-true "a missing path -> tree still readable" (:tree-readable? facts))
  (assert-false "a missing path -> path does not exist" (:path-exists? facts)))

(let [{:keys [root cited-commit]} (mk-fixture-repo! {})
      facts (pre-qa-gate-gather-lib/gather-acceptance-pointer-facts
             root cited-commit "id: BL-999\n")]
  (assert= "no acceptance: field -> raw declaration is nil, nothing else computed"
           {:raw-declaration nil} facts))

(let [{:keys [root cited-commit]} (mk-fixture-repo! {})
      facts (pre-qa-gate-gather-lib/gather-acceptance-pointer-facts
             root cited-commit "id: BL-999\nacceptance: |\n  Feature: inline\n    Scenario: x\n      Given known\n")]
  (assert= "an inline (block-scalar) declaration -> nothing computed (not applicable)"
           "|" (:raw-declaration facts))
  (assert-true "no git work is done for an inapplicable declaration" (nil? (:tree-readable? facts))))

;; ── the parked-draft shape passes existence unchanged (BL-233) ───────────

(let [{:keys [root cited-commit]} (mk-fixture-repo! {:feature-path "specs/features/fixture.feature.draft"})
      facts (pre-qa-gate-gather-lib/gather-acceptance-pointer-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature.draft\n")]
  (assert-true "a parked .feature.draft that exists at the cited commit -> path exists (draft-ness irrelevant)"
               (:path-exists? facts)))

;; ── judged at the cited commit, not the working tree tip ─────────────────

(let [{:keys [root cited-commit]} (mk-fixture-repo! {})]
  (fs/delete (fs/path root "specs" "features" "fixture.feature"))
  (git! root "add" "-A")
  (git! root "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "delete on the working tree tip")
  (let [facts (pre-qa-gate-gather-lib/gather-acceptance-pointer-facts
               root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
    (assert-true "a file deleted AFTER the cited commit still reads as present AT the cited commit"
                 (:path-exists? facts))))

;; ── tree unreadable -> fails open, path-exists? never probed ─────────────

(let [{:keys [root cited-commit]} (mk-fixture-repo! {})
      full-sha (git-out root "rev-parse" "HEAD")]
  (corrupt-tree-object! root full-sha)
  (let [facts (pre-qa-gate-gather-lib/gather-acceptance-pointer-facts
               root cited-commit "id: BL-999\nacceptance: specs/features/fixture.feature\n")]
    (assert-false "a corrupted tree object -> tree not readable" (:tree-readable? facts))
    (assert= "path-exists? is never probed once the tree itself is unreadable"
             nil (:path-exists? facts))))

;; ── end to end through evaluate ───────────────────────────────────────────

(let [{:keys [root cited-commit]} (mk-fixture-repo! {})
      facts (pre-qa-gate-gather-lib/gather-acceptance-pointer-facts
             root cited-commit "id: BL-999\nacceptance: specs/features/does-not-exist.feature\n")
      result (acceptance-pointer-gate-lib/evaluate
              (assoc facts :ticket-id "BL-999" :cited-commit cited-commit))]
  (assert= "a missing path, fed through evaluate, produces exactly one finding"
           1 (count (:findings result)))
  (assert= "the finding's class is :acceptance-pointer"
           :acceptance-pointer (:class (first (:findings result)))))

;; ── pointer-findings-for-git-handoff: arming ──────────────────────────────

(let [{:keys [root cited-commit]} (mk-fixture-repo! {})]
  (fs/create-dirs (fs/path root "backlog" "active"))
  (write-file! (fs/path root "backlog" "active" "BL-999-fixture.yaml")
               "id: BL-999\nacceptance: specs/features/does-not-exist.feature\n")
  (git! root "add" "-A")
  (git! root "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "add ticket yaml")
  (let [ticket-commit (git-out root "rev-parse" "--short=10" "HEAD")]
    (let [result (pre-qa-gate-gather-lib/pointer-findings-for-git-handoff
                  root {:to "cleaner" :task-name "BL-999-fix" :cited-commit ticket-commit})]
      (assert= "a stale pointer addressed to cleaner (pre-QA hop) is one finding"
               1 (count (:findings result))))
    (let [result (pre-qa-gate-gather-lib/pointer-findings-for-git-handoff
                  root {:to "QA" :task-name "BL-999-fix" :cited-commit ticket-commit})]
      (assert= "the SAME stale pointer addressed to QA is not this gate's concern - skips silently"
               {:findings [] :warnings []} result))
    (let [result (pre-qa-gate-gather-lib/pointer-findings-for-git-handoff
                  root {:to "cleaner,QA" :task-name "BL-999-fix" :cited-commit ticket-commit})]
      (assert= "membership (QA anywhere in a multi-recipient to:) also skips, not just equality"
               {:findings [] :warnings []} result))
    (let [result (pre-qa-gate-gather-lib/pointer-findings-for-git-handoff
                  root {:to "cleaner" :task-name "no-ticket-id-here" :cited-commit ticket-commit})]
      (assert= "a task name with no extractable ticket id skips silently"
               {:findings [] :warnings []} result))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: pre_qa_gate_gather_lib.bb (acceptance-pointer)"))
