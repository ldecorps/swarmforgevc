#!/usr/bin/env bb
;; BL-1041: TDD runner for rescue_lib.bb - the pure decisions behind rescuing
;; orphaned work. No git, no real stash, no worktree: every fact the decisions
;; need is passed in.

(ns rescue-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "rescue_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── invariant 1: the source is released only after a verified commit ──────
;; This is the whole defect. The 2026-08-22 rescue dropped the stash entry in
;; the same operation that applied it, so for about an hour the only copies
;; were a dirty working tree and an evidence file written by hand.

(assert-false "no commit at all: releasing the source is never allowed"
              (rescue-lib/source-release-allowed?
                {:commit-sha nil :branch "swarm/coder" :content-verified? true}))

(assert-false "a commit that is on NO branch does not make the source releasable"
              ;; A dangling commit is exactly as recoverable as the stash was -
              ;; which is to say, only by someone who knows to look.
              (rescue-lib/source-release-allowed?
                {:commit-sha "abc1234567" :branch nil :content-verified? true}))

(assert-false "a commit whose CONTENT was not verified does not make it releasable"
              ;; qa_e2e step 2: confirm by reading the content out of the
              ;; commit, never by trusting its subject line.
              (rescue-lib/source-release-allowed?
                {:commit-sha "abc1234567" :branch "swarm/coder" :content-verified? false}))

(assert-true "all three together: a verified commit on a branch releases the source"
             (rescue-lib/source-release-allowed?
               {:commit-sha "abc1234567" :branch "swarm/coder" :content-verified? true}))

;; ── the plan's ORDER is the invariant, not merely its contents ────────────

(let [steps (mapv :step (rescue-lib/rescue-plan {:role "coder" :paths ["a.ts"] :reason "BL-981 stash"}))]
  (assert-true "the plan commits before it releases the source"
               (< (.indexOf steps :commit) (.indexOf steps :release-source)))
  (assert-true "and verifies the commit's content before releasing too"
               (< (.indexOf steps :verify) (.indexOf steps :release-source)))
  (assert-true "and notifies the owning role"
               (>= (.indexOf steps :notify) 0))
  (assert= "the release step is never first" false (= :release-source (first steps))))

(let [plan (rescue-lib/rescue-plan {:role "coder" :paths ["a.ts"] :reason "BL-981 stash"})
      release (first (filter #(= :release-source (:step %)) plan))]
  (assert-true "the release step carries a guard rather than running unconditionally"
               (contains? release :guard))
  (assert= "and that guard is the durability decision itself"
           :source-release-allowed? (:guard release)))

;; ── invariant 2: the owner of a touched worktree is told what and why ─────

(let [d (rescue-lib/notification-draft {:role "coder"
                                        :paths ["extension/src/concierge/pipelineBoard.ts"]
                                        :reason "BL-981 seat-fold stash rescue"
                                        :commit-sha "abc1234567"})]
  (assert= "the note is addressed to the role whose worktree was touched" "coder" (:to d))
  (assert= "it is a note, not a parcel - a rescue is not work being assigned" "note" (:type d))
  (assert-true "the message names WHY it landed" (str/includes? (:message d) "BL-981"))
  (assert-true "the message names the commit, so the owner can read the content out of it"
               (str/includes? (:message d) "abc1234567")))

;; A notification that swarm_handoff.sh REFUSES is not a notification. The
;; header cap is 80 characters and a refusal prints usage rather than sending,
;; so an over-long draft would fail silently - the exact harm invariant 2 is
;; about.
(let [d (rescue-lib/notification-draft
          {:role "coder"
           :paths (mapv #(str "extension/src/very/deeply/nested/path/number-" % "/file.ts") (range 12))
           :reason "a rescue reason long enough to blow the cap on its own, several times over"
           :commit-sha "abc1234567"})]
  (assert-true "a draft with many long paths still fits the 80-character message cap"
               (<= (count (:message d)) 80))
  (assert-true "and still names the commit, which is the part that makes it actionable"
               (str/includes? (:message d) "abc1234567")))

(let [d (rescue-lib/notification-draft {:role "coder" :paths ["a.ts" "b.ts" "c.ts"]
                                        :reason "r" :commit-sha "abc1234567"})]
  (assert-true "when paths are elided the count is still stated, never silently dropped"
               (str/includes? (:message d) "3")))

;; ── invariant 2's other half: this never fires on the ordinary path ───────

(assert-false "a role committing its own work for its own ticket is not a rescue"
              (rescue-lib/rescue-required? {:actor "coder" :worktree-role "coder"}))

(assert-true "another actor placing work in a role's worktree IS a rescue"
             (rescue-lib/rescue-required? {:actor "coordinator" :worktree-role "coder"}))

(assert-false "an actor working in its own worktree is never a rescue, whoever it is"
              (rescue-lib/rescue-required? {:actor "architect" :worktree-role "architect"}))

(if (empty? @failures)
  (println "ALL PASS: rescue_lib.bb")
  (do (doseq [f @failures] (println f)) (System/exit 1)))
