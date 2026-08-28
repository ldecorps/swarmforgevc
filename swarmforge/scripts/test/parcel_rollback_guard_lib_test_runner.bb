#!/usr/bin/env bb
;; TDD runner for parcel_rollback_guard_lib.bb (BL-1213) - the send-time
;; gate that refuses a git_handoff whose branch tip holds pre-parcel
;; content for a path the ticket's accepted parcel commit changed, with no
;; revert of it on this branch. Truth-table coverage of path-rolled-back?
;; lives in the property runner (bl1213_parcel_rollback_guard_property_
;; runner.bb, invariants 1/2); this file covers blocked?, refusal-message,
;; and findings-for-git-handoff's real-git-fixture shapes (scenario
;; outline rows, scenario 02's multi-path naming, scenario 04's fail-open).

(ns parcel-rollback-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "parcel_rollback_guard_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── blocked? ──────────────────────────────────────────────────────────────

(assert-true "non-empty findings -> blocked"
             (parcel-rollback-guard-lib/blocked? {:findings [{:path "a.txt" :parcel-commit "abc123"}]}))
(assert-false "empty findings -> not blocked"
              (parcel-rollback-guard-lib/blocked? {:findings []}))
(assert-false "nil findings -> not blocked"
              (parcel-rollback-guard-lib/blocked? {:findings nil}))

;; ── refusal-message: names every path and the parcel commit (scenario 02) ─

(let [msg (parcel-rollback-guard-lib/refusal-message
           {:task-name "BL-592-fixture"
            :findings [{:path "a.txt" :parcel-commit "e5cf2a3af1"}
                       {:path "b.txt" :parcel-commit "e5cf2a3af1"}
                       {:path "c.txt" :parcel-commit "e5cf2a3af1"}]})]
  (assert-includes "refusal names path a.txt" msg "a.txt")
  (assert-includes "refusal names path b.txt" msg "b.txt")
  (assert-includes "refusal names path c.txt" msg "c.txt")
  (assert-includes "refusal names the parcel commit" msg "e5cf2a3af1")
  (assert-includes "refusal names the task" msg "BL-592-fixture"))

(let [msg (parcel-rollback-guard-lib/refusal-message
           {:task-name "BL-592-fixture"
            :findings [{:path "a.txt" :parcel-commit "e5cf2a3af1"}]})]
  (assert-includes "single-path refusal reads 'one path'" msg "one path"))

;; ── findings-for-git-handoff: real git fixture, the outline's four rows ──

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1213-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (fs/create-dirs (fs/path ~root-sym ".swarmforge" "handoffs" "inbox" "in_process"))
       (spit (str (fs/path ~root-sym ".swarmforge" "roles.tsv"))
             (str "cleaner\tcleaner-wt\t" ~root-sym "\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n"))
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(defn- commit! [root path content message]
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- seed-parcel! [root task-name commit-short]
  (spit (str (fs/path root ".swarmforge" "handoffs" "inbox" "in_process" "00_received.handoff"))
        (str "id: x\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: coder\n"
             "task: " task-name "\ncommit: " commit-short "\n"
             "created_at: 2026-08-28T00:00:00Z\n\nbody\n")))

;; row 1: pre-parcel content, no revert -> refused
(with-fixture [root]
  (commit! root "file.txt" "pre-parcel content\n" "seed file")
  (commit! root "file.txt" "parcel content\n" "BL-1213-fixture: parcel change")
  (let [parcel-short (:out (sh! root "git" "rev-parse" "--short=10" "HEAD"))]
    (seed-parcel! root "BL-1213-fixture" parcel-short)
    (commit! root "file.txt" "pre-parcel content\n" "recovery: restore tree (bulk restore, not a revert)")
    (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
          result (parcel-rollback-guard-lib/findings-for-git-handoff
                  {:root root :sender "cleaner" :task-name "BL-1213-fixture" :canonical canonical})]
      (assert-true "row 1 (pre-parcel, no revert): blocked" (parcel-rollback-guard-lib/blocked? result))
      (assert= "row 1: exactly one finding" 1 (count (:findings result)))
      (assert= "row 1: finding names the right path" "file.txt" (:path (first (:findings result)))))))

;; row 1 -> row 3 (non-vacuity companion): pre-parcel content, WITH a
;; genuine revert -> allowed
(with-fixture [root]
  (commit! root "file.txt" "pre-parcel content\n" "seed file")
  (commit! root "file.txt" "parcel content\n" "BL-1213-fixture: parcel change")
  (let [parcel-full (:out (sh! root "git" "rev-parse" "HEAD"))
        parcel-short (:out (sh! root "git" "rev-parse" "--short=10" "HEAD"))]
    (seed-parcel! root "BL-1213-fixture" parcel-short)
    (sh! root "git" "revert" "--no-edit" parcel-full)
    (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
          result (parcel-rollback-guard-lib/findings-for-git-handoff
                  {:root root :sender "cleaner" :task-name "BL-1213-fixture" :canonical canonical})]
      (assert-false "row 2 (pre-parcel, revert present): not blocked" (parcel-rollback-guard-lib/blocked? result))
      (assert= "row 2: no findings" [] (:findings result)))))

;; row 3: tip still holds the parcel's own content -> allowed
(with-fixture [root]
  (commit! root "file.txt" "pre-parcel content\n" "seed file")
  (commit! root "file.txt" "parcel content\n" "BL-1213-fixture: parcel change")
  (let [parcel-short (:out (sh! root "git" "rev-parse" "--short=10" "HEAD"))
        canonical (:out (sh! root "git" "rev-parse" "HEAD"))]
    (seed-parcel! root "BL-1213-fixture" parcel-short)
    (let [result (parcel-rollback-guard-lib/findings-for-git-handoff
                  {:root root :sender "cleaner" :task-name "BL-1213-fixture" :canonical canonical})]
      (assert-false "row 3 (tip == parcel content): not blocked" (parcel-rollback-guard-lib/blocked? result))
      (assert= "row 3: no findings" [] (:findings result)))))

;; row 4: later, genuinely different content -> allowed
(with-fixture [root]
  (commit! root "file.txt" "pre-parcel content\n" "seed file")
  (commit! root "file.txt" "parcel content\n" "BL-1213-fixture: parcel change")
  (let [parcel-short (:out (sh! root "git" "rev-parse" "--short=10" "HEAD"))]
    (seed-parcel! root "BL-1213-fixture" parcel-short)
    (commit! root "file.txt" "genuinely different later content\n" "later work: different content for the same path")
    (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
          result (parcel-rollback-guard-lib/findings-for-git-handoff
                  {:root root :sender "cleaner" :task-name "BL-1213-fixture" :canonical canonical})]
      (assert-false "row 4 (later, different content): not blocked" (parcel-rollback-guard-lib/blocked? result))
      (assert= "row 4: no findings" [] (:findings result)))))

;; scenario 02: three of the parcel's paths rolled back -> all three named
(with-fixture [root]
  (commit! root "a.txt" "pre-a\n" "seed")
  (spit (str (fs/path root "b.txt")) "pre-b\n")
  (spit (str (fs/path root "c.txt")) "pre-c\n")
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" "seed b and c too")
  (spit (str (fs/path root "a.txt")) "parcel-a\n")
  (spit (str (fs/path root "b.txt")) "parcel-b\n")
  (spit (str (fs/path root "c.txt")) "parcel-c\n")
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" "BL-1213-fixture: parcel touches three paths")
  (let [parcel-short (:out (sh! root "git" "rev-parse" "--short=10" "HEAD"))]
    (seed-parcel! root "BL-1213-fixture" parcel-short)
    (spit (str (fs/path root "a.txt")) "pre-a\n")
    (spit (str (fs/path root "b.txt")) "pre-b\n")
    (spit (str (fs/path root "c.txt")) "pre-c\n")
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "recovery: restore tree")
    (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
          result (parcel-rollback-guard-lib/findings-for-git-handoff
                  {:root root :sender "cleaner" :task-name "BL-1213-fixture" :canonical canonical})
          msg (parcel-rollback-guard-lib/refusal-message
               {:task-name "BL-1213-fixture" :findings (:findings result)})]
      (assert-true "scenario 02: blocked" (parcel-rollback-guard-lib/blocked? result))
      (assert= "scenario 02: all three paths found" 3 (count (:findings result)))
      (assert-includes "scenario 02: refusal names a.txt" msg "a.txt")
      (assert-includes "scenario 02: refusal names b.txt" msg "b.txt")
      (assert-includes "scenario 02: refusal names c.txt" msg "c.txt"))))

;; scenario 04: the recorded parcel commit cannot be read -> warn, allow
(with-fixture [root]
  (commit! root "file.txt" "pre-parcel content\n" "seed file")
  (seed-parcel! root "BL-1213-fixture" "deadbeef00")
  (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
        result (parcel-rollback-guard-lib/findings-for-git-handoff
                {:root root :sender "cleaner" :task-name "BL-1213-fixture" :canonical canonical})]
    (assert-false "scenario 04: not blocked" (parcel-rollback-guard-lib/blocked? result))
    (assert-true "scenario 04: a warning is present" (some? (:warning result)))
    (assert-includes "scenario 04: warning names the ticket" (:warning result) "BL-1213")
    (assert-includes "scenario 04: warning names the unreadable commit" (:warning result) "deadbeef00")))

;; no recorded parcel at all (fresh task, nothing received yet) -> silent,
;; never a warning - the ordinary case, distinct from scenario 04's genuine
;; unreadable-fact fail-open.
(with-fixture [root]
  (commit! root "file.txt" "content\n" "seed file")
  (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
        result (parcel-rollback-guard-lib/findings-for-git-handoff
                {:root root :sender "cleaner" :task-name "BL-1213-fixture" :canonical canonical})]
    (assert-false "no recorded parcel: not blocked" (parcel-rollback-guard-lib/blocked? result))
    (assert-true "no recorded parcel: no warning (ordinary case, not a fact-read failure)"
                 (nil? (:warning result)))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: parcel_rollback_guard_lib.bb"))
