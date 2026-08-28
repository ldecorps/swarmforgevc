#!/usr/bin/env bb
;; BL-1213 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over parcel_rollback_guard_lib.bb, encoding
;; both declared invariants.
;;
;;   invariant 2 - "A rollback the branch's own history explains is never
;;      refused ... only content byte-identical to the parcel commit's
;;      PARENT, with no revert accounting for it, is a finding": a
;;      generative truth-table property over the pure path-rolled-back?
;;      across every combination of {tip blob present/absent/equal-to-
;;      parent/genuinely different}, {parent blob present/absent},
;;      {a revert present/absent} - finding iff tip and parent are both
;;      present AND byte-identical AND no revert explains it.
;;
;;   invariant 1 - "computed from git objects and the recorded parcel
;;      commit alone ... never from any working tree": path-rolled-back?
;;      itself takes only blob-sha strings, so by construction it cannot
;;      read a working tree - the interesting claim is about its caller,
;;      findings-for-git-handoff, which this property cannot reach with
;;      generated data (it needs a real git ref graph). Encoded instead as
;;      a single real-git-fixture case below: a dirty, UNCOMMITTED working
;;      tree edit that would flip the verdict if read is left in place, and
;;      the gate's answer is asserted to come from the committed tip alone.
;;
;; Same seeded RNG convention as this directory's other property runners
;; (e.g. bl953_task_commit_coherence_property_runner.bb) - no shared
;; framework, each runner owns its own loop.
;;
;; Non-vacuity proven by hand at authoring time: relaxing path-rolled-back?
;; to ignore `reverted?` (a mutant that flags every byte-identical rollback
;; regardless of a legitimate bounce revert) fails the property on its
;; first "reverted? true" generated case; relaxing it to ignore parent-blob
;; nil-ness (flagging a path the parcel commit itself introduced) fails on
;; its first "parent-blob nil" case. Both restored before landing.

(ns bl1213-parcel-rollback-guard-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "parcel_rollback_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 2000))
(def failures (atom []))
(def ^:private rng (java.util.Random. 1213))
(defn- rint [n] (.nextInt rng (int n)))
(defn- rbool [] (.nextBoolean rng))
(defn- rpick [coll] (nth (vec coll) (rint (count coll))))

(defn- rsha []
  (apply str (repeatedly 8 #(rpick "0123456789abcdef"))))

;; ── invariant 2: the truth table, generatively ───────────────────────────

(defn expected-rolled-back? [{:keys [tip-blob parent-blob reverted?]}]
  (boolean (and tip-blob parent-blob (= tip-blob parent-blob) (not reverted?))))

(def finding-cases-reached (atom 0))

(dotimes [_ runs]
  (let [shape (rint 5)
        parent (rsha)
        scenario (case shape
                   0 {:tip-blob parent :parent-blob parent :reverted? false}      ; byte-identical, no revert -> finding
                   1 {:tip-blob parent :parent-blob parent :reverted? true}       ; byte-identical, revert present -> allowed
                   2 {:tip-blob (rsha) :parent-blob parent :reverted? (rbool)}    ; genuinely different tip -> allowed
                   3 {:tip-blob parent :parent-blob nil :reverted? (rbool)}       ; parcel introduced the path -> allowed
                   4 {:tip-blob nil :parent-blob parent :reverted? (rbool)})      ; path now deleted -> allowed
        expected (expected-rolled-back? scenario)
        actual (parcel-rollback-guard-lib/path-rolled-back? scenario)]
    (when (= 0 shape) (swap! finding-cases-reached inc))
    (when (not= expected actual)
      (swap! failures conj (str "FAIL: expected " expected " got " actual " for " (pr-str scenario))))))

(when (zero? @finding-cases-reached)
  (swap! failures conj "FAIL reachability: the refusing (byte-identical, unreverted) shape never generated"))

;; A revert commit's own presence must never itself be mistaken for a
;; finding - reverted? true always resolves to false regardless of the two
;; blob values agreeing, asserted directly (not just via the generative
;; loop's shape 1) since this is the exact discriminator the incident
;; needed and BL-1098's own predicate got wrong for the mirror-image shape.
(when (parcel-rollback-guard-lib/path-rolled-back?
       {:tip-blob "abc123" :parent-blob "abc123" :reverted? true})
  (swap! failures conj "FAIL invariant 2: a reverted rollback was still flagged as a finding"))

;; ── invariant 1: a real git fixture, dirty working tree never read ──────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(let [root (str (fs/create-temp-dir {:prefix "bl1213-invariant1-"}))]
  (try
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    (fs/create-dirs (fs/path root ".swarmforge" "handoffs" "inbox" "in_process"))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str "cleaner\tcleaner-wt\t" root "\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n"))
    (spit (str (fs/path root "file.txt")) "pre-parcel content\n")
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "seed file")
    (spit (str (fs/path root "file.txt")) "parcel content\n")
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "BL-1213-fixture: parcel change")
    (let [parcel-commit-short (:out (sh! root "git" "rev-parse" "--short=10" "HEAD"))]
      (spit (str (fs/path root ".swarmforge" "handoffs" "inbox" "in_process" "00_received.handoff"))
            (str "id: x\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: coder\n"
                 "task: BL-1213-fixture\ncommit: " parcel-commit-short "\n"
                 "created_at: 2026-08-28T00:00:00Z\n\nbody\n"))
      (spit (str (fs/path root "file.txt")) "pre-parcel content\n")
      (sh! root "git" "add" "-A")
      (sh! root "git" "commit" "-q" "-m" "recovery: restore tree (bulk restore, not a revert)")
      (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
            ;; the dirty edit: were findings-for-git-handoff to read the
            ;; WORKING TREE for file.txt instead of canonical's committed
            ;; blob, this would read as "parcel content" (no finding) -
            ;; the opposite of the correct, git-objects-only answer.
            _ (spit (str (fs/path root "file.txt")) "parcel content\n")
            result (parcel-rollback-guard-lib/findings-for-git-handoff
                    {:root root :sender "cleaner" :task-name "BL-1213-fixture"
                     :canonical canonical})]
        (when (:warning result)
          (swap! failures conj (str "FAIL invariant 1 setup: unexpected warning " (:warning result))))
        (when-not (= 1 (count (:findings result)))
          (swap! failures conj
                 (str "FAIL invariant 1: expected the committed tip (pre-parcel) to be flagged "
                      "regardless of the dirty uncommitted working-tree edit (which reads as "
                      "parcel content) - got findings: " (pr-str (:findings result)))))))
    (finally
      (fs/delete-tree root))))

;; ── report ───────────────────────────────────────────────────────────────

(println (str "parcel_rollback_guard_lib property: " runs " runs"))
(if (seq @failures)
  (do (doseq [f (take 10 @failures)] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
