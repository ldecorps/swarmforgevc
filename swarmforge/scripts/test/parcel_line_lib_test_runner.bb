#!/usr/bin/env bb
;; TDD runner for parcel_line_lib.bb (BL-1871). The pure decisions are
;; asserted directly; take-up! runs against a mkdtemp git fixture (never
;; the live checkout - proven by --git-common-dir before any write).
(ns parcel-line-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "parcel_line_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── parcel-intent ─────────────────────────────────────────────────────────
(def handoff {:master? false :role "architect" :type "git_handoff" :commit "abc1234567"})

(assert= "a forwarding git_handoff is taken up on its own commit"
         {:intent :take-up :commit "abc1234567"}
         (parcel-line-lib/parcel-intent handoff))

(assert= "a master-resident role never moves"
         :skip (:intent (parcel-line-lib/parcel-intent (assoc handoff :master? true))))

(assert= "an unknown role row never moves"
         :skip (:intent (parcel-line-lib/parcel-intent (assoc handoff :master? nil))))

(assert= "a non-forwarding copy moves nothing"
         :skip (:intent (parcel-line-lib/parcel-intent (assoc handoff :non-forwarding? true))))

(assert= "a git_handoff with no commit moves nothing"
         :skip (:intent (parcel-line-lib/parcel-intent (dissoc handoff :commit))))

(assert= "a Work note to the coder starts its ticket"
         {:intent :start :ticket "BL-9002"}
         (parcel-line-lib/parcel-intent {:master? false :role "coder" :type "note" :work-ticket "BL-9002"}))

(assert= "a Work note to a coder seat starts its ticket"
         {:intent :start :ticket "BL-9002"}
         (parcel-line-lib/parcel-intent {:master? false :role "coder@2" :type "note" :work-ticket "BL-9002"}))

(assert= "a Work note to another role moves nothing"
         :skip (:intent (parcel-line-lib/parcel-intent {:master? false :role "architect" :type "note" :work-ticket "BL-9002"})))

(assert= "a merge-up note moves nothing"
         :skip (:intent (parcel-line-lib/parcel-intent {:master? false :role "architect" :type "note" :work-ticket nil})))

;; ── move-decision ─────────────────────────────────────────────────────────
(assert= "a head at or past the target stays"
         {:action :stay}
         (parcel-line-lib/move-decision {:target "c" :at-or-past-target? true :dirty-paths ["a"]}))

(assert= "an own line already carrying the ticket stays"
         {:action :stay}
         (parcel-line-lib/move-decision {:target "c" :at-or-past-target? false :own-line? true}))

(assert= "dirty tracked files block the move"
         {:action :blocked :paths ["x.txt"]}
         (parcel-line-lib/move-decision {:target "c" :at-or-past-target? false :dirty-paths ["x.txt"]}))

(assert= "a clean worktree off the target moves"
         {:action :move :target "c"}
         (parcel-line-lib/move-decision {:target "c" :at-or-past-target? false :dirty-paths []}))

(assert= "no target resolved stays put"
         {:action :stay}
         (parcel-line-lib/move-decision {:target nil :at-or-past-target? false :dirty-paths []}))

;; ── subject-names-only? ──────────────────────────────────────────────────
(assert= "a subject naming only the ticket" true (parcel-line-lib/subject-names-only? "BL-9002: build it" "BL-9002"))
(assert= "a subject naming another ticket too" false (parcel-line-lib/subject-names-only? "BL-9002, BL-9003: both" "BL-9002"))
(assert= "a longer id is not the ticket" false (parcel-line-lib/subject-names-only? "BL-90021: x" "BL-9002"))
(assert= "a merge subject names no ticket" false (parcel-line-lib/subject-names-only? "Merge main abc into coder." "BL-9002"))

;; ── task-matches? ────────────────────────────────────────────────────────
(assert= "bare id" true (parcel-line-lib/task-matches? "BL-9002" "BL-9002"))
(assert= "slugged" true (parcel-line-lib/task-matches? "BL-9002-thing" "BL-9002"))
(assert= "longer id" false (parcel-line-lib/task-matches? "BL-90021" "BL-9002"))
(assert= "nil task" false (parcel-line-lib/task-matches? nil "BL-9002"))

;; ── take-up! against a fixture repo ──────────────────────────────────────
(defn- git [dir & args]
  (let [r (apply process/sh "git" "-C" (str dir) args)]
    (when-not (zero? (:exit r)) (throw (ex-info (str "git " (str/join " " args) ": " (:err r)) {})))
    (str/trim (:out r))))

(defn- commit! [dir file content msg]
  (spit (str (fs/path dir file)) content)
  (git dir "add" file)
  (git dir "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" msg)
  (git dir "rev-parse" "HEAD"))

(let [root (str (fs/create-temp-dir {:prefix "parcel-line-lib-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (assert= "fixture is its own repo" (str (fs/path root ".git"))
             (str (fs/absolutize (fs/path root (git root "rev-parse" "--git-common-dir")))))
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-architect" wt)
          old (commit! wt "old.txt" "o\n" "BL-9000: other ticket")
          _ (git wt "checkout" "-q" "-b" "line" "origin/main")
          c (commit! wt "new.txt" "n\n" "BL-9001: own line")
          _ (git wt "checkout" "-q" "swarmforge-architect")
          facts {:root wt :role "architect" :intent {:intent :take-up :commit c}}
          out (with-out-str (parcel-line-lib/take-up! facts))]
      (assert= "take-up! moves HEAD onto the cited commit" c (git wt "rev-parse" "HEAD"))
      (assert= "the role branch is kept" "swarmforge-architect" (git wt "rev-parse" "--abbrev-ref" "HEAD"))
      (assert= "the old head is kept under a parcel-backup ref" true
               (str/includes? (git wt "for-each-ref" "--format=%(objectname)" "refs/swarmforge/parcel-backup/architect/") old))
      (assert= "take-up! reports the move" true (str/includes? out "PARCEL_LINE: moved"))
      ;; work on top is never moved back
      (let [mine (commit! wt "mine.txt" "m\n" "BL-9001: architect pass")]
        (parcel-line-lib/take-up! facts)
        (assert= "work on top is never moved back" mine (git wt "rev-parse" "HEAD")))
      ;; dirty tracked change blocks
      (git wt "checkout" "-q" "-B" "swarmforge-architect" old)
      (spit (str (fs/path wt "a.txt")) "dirty\n")
      (let [out (with-out-str (parcel-line-lib/take-up! facts))]
        (assert= "a dirty worktree is not moved" old (git wt "rev-parse" "HEAD"))
        (assert= "the blocked line names the file" true (str/includes? out "a.txt"))
        (assert= "the blocked line says not taken up" true (str/includes? out "not taken up"))))
    (finally (fs/delete-tree root))))

;; ── take-up! :start path and the own-line exception ────────────────────────
;; BL-1871's own description: "when the coder's current line already carries
;; unlanded commits that name X and no other ticket, it stays there, so a
;; re-sent Work note never strands work the coder has not yet forwarded."
;; This is own-line?'s whole reason to exist; exercise it for real, through
;; take-up! itself, not just as a pre-decided boolean fed to move-decision.
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-lib-start-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          own (commit! wt "mine.txt" "m\n" "BL-9002: own unlanded work")
          facts {:root wt :role "coder" :project-root root :intent {:intent :start :ticket "BL-9002"}}]
      (parcel-line-lib/take-up! facts)
      (assert= "a line already carrying only the ticket's own unlanded work stays, not restarted from origin/main"
               own (git wt "rev-parse" "HEAD")))
    (finally (fs/delete-tree root))))

(let [root (str (fs/create-temp-dir {:prefix "parcel-line-lib-start-other-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          _ (commit! wt "other.txt" "o\n" "BL-9000: another ticket's unlanded work")
          main-sha (git root "rev-parse" "origin/main")
          facts {:root wt :role "coder" :project-root root :intent {:intent :start :ticket "BL-9002"}}]
      (parcel-line-lib/take-up! facts)
      (assert= "a line carrying another ticket's work is not the Work note's own line; it restarts from origin/main"
               main-sha (git wt "rev-parse" "HEAD")))
    (finally (fs/delete-tree root))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: parcel_line_lib.bb"))
