#!/usr/bin/env bb
;; TDD runner for orphan_claim_sweep_lib.bb (BL-648). Real filesystem (tmp
;; dirs), fake session-alive? adapter - no tmux, no live swarm, matching the
;; fixture_reaper_sweep_lib.bb / orphan_agent_reaper_sweep_lib.bb test style
;; already used in this suite.

(ns orphan-claim-sweep-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "orphan_claim_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-orphan-claim-sweep-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn role-info [role worktree-path]
  {:role role :worktree-name role :worktree-path worktree-path
   :session (str "swarmforge-" role) :display role :agent "claude" :receive-mode "task"})

(defn write-handoff! [dir basename]
  (fs/create-dirs dir)
  (spit (str (fs/path dir basename))
        (str "id: t\nfrom: specifier\nto: someone\nrecipient: someone\npriority: 00\n"
             "type: git_handoff\ntask: demo\ncommit: 1234567890\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n")))

;; ── flat (task-mode) claim: dead owner, not the resumed role -> reclaimed ──
(let [root (mk-tmp-dir)
      cleaner-wt (str (fs/path root "cleaner-worktree"))
      cleaner (role-info "cleaner" cleaner-wt)
      in-process (handoff-lib/mailbox-dir cleaner :in_process)
      logged (atom [])]
  (write-handoff! in-process "00_20260101T000000Z_000001_from_a_to_cleaner_for_cleaner.handoff")
  (spit (str (fs/path in-process "00_20260101T000000Z_000001_from_a_to_cleaner_for_cleaner.handoff.nudge")) "n")
  (let [results (orphan-claim-sweep-lib/sweep!
                 {:roles [cleaner]
                  :session-alive? (fn [_] false)
                  :resumed-role "QA"
                  :log! (fn [line] (swap! logged conj line))})]
    (assert= "BL-648-04: dead-owner claim is reported reclaimed"
             [{:role "cleaner"
               :reclaimed [(str (fs/path (handoff-lib/mailbox-dir cleaner :new)
                                          "00_20260101T000000Z_000001_from_a_to_cleaner_for_cleaner.handoff"))]}]
             results)
    (assert-false "BL-648-04: the handoff no longer sits in in_process"
                  (fs/exists? (fs/path in-process "00_20260101T000000Z_000001_from_a_to_cleaner_for_cleaner.handoff")))
    (assert-true "BL-648-04: the handoff now sits in inbox/new with its original priority prefix"
                 (fs/exists? (fs/path (handoff-lib/mailbox-dir cleaner :new)
                                       "00_20260101T000000Z_000001_from_a_to_cleaner_for_cleaner.handoff")))
    (assert-false "BL-648-04: the stale .nudge sidecar did not travel with it"
                  (fs/exists? (fs/path (handoff-lib/mailbox-dir cleaner :new)
                                        "00_20260101T000000Z_000001_from_a_to_cleaner_for_cleaner.handoff.nudge")))
    (assert-true "BL-648-04: a loud reclaim line was logged, naming the role"
                 (some #(str/includes? % "role=cleaner") @logged))))

;; ── BL-648-05: owner alive -> the parcel remains claimed, untouched ───────
(let [root (mk-tmp-dir)
      cleaner-wt (str (fs/path root "cleaner-worktree"))
      cleaner (role-info "cleaner" cleaner-wt)
      in-process (handoff-lib/mailbox-dir cleaner :in_process)]
  (write-handoff! in-process "00_x_from_a_to_cleaner_for_cleaner.handoff")
  (let [results (orphan-claim-sweep-lib/sweep!
                 {:roles [cleaner]
                  :session-alive? (fn [_] true)
                  :resumed-role nil
                  :log! (fn [_])})]
    (assert= "BL-648-05: nothing reclaimed for a live owner"
             [{:role "cleaner" :reclaimed []}]
             results)
    (assert-true "BL-648-05: the parcel remains claimed in in_process"
                 (fs/exists? (fs/path in-process "00_x_from_a_to_cleaner_for_cleaner.handoff")))
    (assert-false "BL-648-05: no copy exists in inbox/new"
                  (fs/exists? (fs/path (handoff-lib/mailbox-dir cleaner :new)
                                        "00_x_from_a_to_cleaner_for_cleaner.handoff")))))

;; ── BL-648-01: the resumed role's own claim is left for it to resume ──────
(let [root (mk-tmp-dir)
      qa-wt (str (fs/path root "qa-worktree"))
      qa (role-info "QA" qa-wt)
      in-process (handoff-lib/mailbox-dir qa :in_process)]
  (write-handoff! in-process "00_x_from_documenter_to_QA_for_QA.handoff")
  (let [results (orphan-claim-sweep-lib/sweep!
                 {:roles [qa]
                  ;; owner is dead (the whole reason we're resuming it) - the
                  ;; being-resumed? bypass must still win.
                  :session-alive? (fn [_] false)
                  :resumed-role "QA"
                  :log! (fn [_])})]
    (assert= "BL-648-01: resumed role's claim reported untouched"
             [{:role "QA" :reclaimed []}]
             results)
    (assert-true "BL-648-01: the claim is still sitting in QA's in_process, ready to resume"
                 (fs/exists? (fs/path in-process "00_x_from_documenter_to_QA_for_QA.handoff")))))

;; ── batch-mode claim: a directory of handoffs reclaims file-by-file ───────
(let [root (mk-tmp-dir)
      hardener-wt (str (fs/path root "hardener-worktree"))
      hardener (role-info "hardender" hardener-wt)
      in-process (handoff-lib/mailbox-dir hardener :in_process)
      batch-dir (fs/path in-process "batch_20260101T000000Z_000001")]
  (write-handoff! batch-dir "00_x_from_a_to_hardender_for_hardender.handoff")
  (write-handoff! batch-dir "00_y_from_b_to_hardender_for_hardender.handoff")
  (spit (str (fs/path batch-dir "00_x_from_a_to_hardender_for_hardender.handoff.chase.json")) "{}")
  (let [results (orphan-claim-sweep-lib/sweep!
                 {:roles [hardener]
                  :session-alive? (fn [_] false)
                  :resumed-role nil
                  :log! (fn [_])})
        new-dir (handoff-lib/mailbox-dir hardener :new)]
    (assert= "batch claim: both handoffs reported reclaimed"
             2 (count (:reclaimed (first results))))
    (assert-true "batch claim: first handoff landed in inbox/new"
                 (fs/exists? (fs/path new-dir "00_x_from_a_to_hardender_for_hardender.handoff")))
    (assert-true "batch claim: second handoff landed in inbox/new"
                 (fs/exists? (fs/path new-dir "00_y_from_b_to_hardender_for_hardender.handoff")))
    (assert-false "batch claim: the now-empty batch directory was cleaned up"
                  (fs/exists? batch-dir))))

;; ── BL-648 architect bounce #1: a colliding target cannot be moved - must
;;    not throw, must surface loudly, must leave the claim in place ───────
(let [root (mk-tmp-dir)
      cleaner-wt (str (fs/path root "cleaner-worktree"))
      cleaner (role-info "cleaner" cleaner-wt)
      in-process (handoff-lib/mailbox-dir cleaner :in_process)
      new-dir (handoff-lib/mailbox-dir cleaner :new)
      basename "00_x_from_a_to_cleaner_for_cleaner.handoff"
      logged (atom [])]
  (write-handoff! in-process basename)
  (write-handoff! new-dir basename)
  (let [results (orphan-claim-sweep-lib/sweep!
                 {:roles [cleaner]
                  :session-alive? (fn [_] false)
                  :resumed-role nil
                  :log! (fn [line] (swap! logged conj line))})]
    (assert= "collision: nothing reported reclaimed (the move failed)"
             [{:role "cleaner" :reclaimed []}]
             results)
    (assert-true "collision: the claim is left in place, not silently dropped"
                 (fs/exists? (fs/path in-process basename)))
    (assert-true "collision: a loud un-reclaimable line was logged, naming the role"
                 (some #(and (str/includes? % "LOUD") (str/includes? % "role=cleaner")) @logged))))

;; ── BL-648 architect bounce #1: one role's sweep failing must not abort the
;;    roles swept after it ─────────────────────────────────────────────────
(let [root (mk-tmp-dir)
      cleaner-wt (str (fs/path root "cleaner-worktree"))
      documenter-wt (str (fs/path root "documenter-worktree"))
      cleaner (role-info "cleaner" cleaner-wt)
      documenter (role-info "documenter" documenter-wt)
      cleaner-in-process (handoff-lib/mailbox-dir cleaner :in_process)
      documenter-in-process (handoff-lib/mailbox-dir documenter :in_process)
      logged (atom [])]
  (write-handoff! cleaner-in-process "00_x_from_a_to_cleaner_for_cleaner.handoff")
  (write-handoff! documenter-in-process "00_y_from_a_to_documenter_for_documenter.handoff")
  (let [results (orphan-claim-sweep-lib/sweep!
                 {:roles [cleaner documenter]
                  :session-alive? (fn [role-info]
                                     (if (= (:role role-info) "cleaner")
                                       (throw (ex-info "simulated liveness-probe failure" {}))
                                       false))
                  :resumed-role nil
                  :log! (fn [line] (swap! logged conj line))})]
    (assert= "isolation: two role entries are still returned despite cleaner's failure"
             2 (count results))
    (assert-true "isolation: the failing role's entry is marked with an error, not reclaimed"
                 (= [] (:reclaimed (first (filter #(= (:role %) "cleaner") results)))))
    (assert-true "isolation: the OTHER role's claim was still reclaimed"
                 (= 1 (count (:reclaimed (first (filter #(= (:role %) "documenter") results))))))
    (assert-true "isolation: a loud line named the failing role"
                 (some #(and (str/includes? % "LOUD") (str/includes? % "role=cleaner")) @logged))))

;; ── BL-648 architect bounce #1: an unexpected leftover in a batch dir keeps
;;    the directory rather than throwing (cleanup is permissive) ──────────
(let [root (mk-tmp-dir)
      hardener-wt (str (fs/path root "hardener-worktree"))
      hardener (role-info "hardender" hardener-wt)
      in-process (handoff-lib/mailbox-dir hardener :in_process)
      batch-dir (fs/path in-process "batch_20260101T000000Z_000002")]
  (write-handoff! batch-dir "00_x_from_a_to_hardender_for_hardender.handoff")
  (spit (str (fs/path batch-dir "unexpected-non-sidecar-file.txt")) "leftover")
  (let [results (orphan-claim-sweep-lib/sweep!
                 {:roles [hardener]
                  :session-alive? (fn [_] false)
                  :resumed-role nil
                  :log! (fn [_])})
        new-dir (handoff-lib/mailbox-dir hardener :new)]
    (assert= "permissive cleanup: the handoff itself was still reclaimed"
             1 (count (:reclaimed (first results))))
    (assert-true "permissive cleanup: reclaiming did not throw despite the leftover file"
                 (fs/exists? (fs/path new-dir "00_x_from_a_to_hardender_for_hardender.handoff")))
    (assert-true "permissive cleanup: the batch dir survives because it is not truly empty"
                 (fs/exists? batch-dir))))

;; ── a role with nothing in in_process is simply absent from the results ──
(let [root (mk-tmp-dir)
      documenter-wt (str (fs/path root "documenter-worktree"))
      documenter (role-info "documenter" documenter-wt)]
  (fs/create-dirs (handoff-lib/mailbox-dir documenter :in_process))
  (let [results (orphan-claim-sweep-lib/sweep!
                 {:roles [documenter]
                  :session-alive? (fn [_] false)
                  :resumed-role nil
                  :log! (fn [_])})]
    (assert= "an empty in_process contributes no result entry" [] results)))

(if (seq @failures)
  (do
    (binding [*out* *err*]
      (doseq [f @failures] (println f)))
    (System/exit 1))
  (println "orphan_claim_sweep_lib_test_runner: ok"))
