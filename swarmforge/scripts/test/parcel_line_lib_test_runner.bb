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
         {:intent :take-up :commit "abc1234567" :ticket nil}
         (parcel-line-lib/parcel-intent handoff))

(assert= "BL-1887: the take-up carries the ticket its task names"
         {:intent :take-up :commit "abc1234567" :ticket "BL-9002"}
         (parcel-line-lib/parcel-intent (assoc handoff :task "BL-9002-some-slug")))

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

;; BL-1904: a checkout that is not the running role's own registered worktree
;; is never moved, whatever else would have moved it.
(assert= "a foreign checkout that would move is refused"
         {:action :foreign}
         (parcel-line-lib/move-decision {:target "c" :at-or-past-target? false :dirty-paths [] :foreign-checkout? true}))

(assert= "a foreign checkout is refused ahead of a dirty one"
         {:action :foreign}
         (parcel-line-lib/move-decision {:target "c" :at-or-past-target? false :dirty-paths ["x.txt"] :foreign-checkout? true}))

(assert= "a foreign checkout that would stay stays, silently"
         {:action :stay}
         (parcel-line-lib/move-decision {:target "c" :at-or-past-target? true :dirty-paths [] :foreign-checkout? true}))

(assert= "foreign-checkout? false changes nothing"
         {:action :move :target "c"}
         (parcel-line-lib/move-decision {:target "c" :at-or-past-target? false :dirty-paths [] :foreign-checkout? false}))

(assert= "foreign-checkout? matches only its own canonical path"
         [false true false]
         [(parcel-line-lib/foreign-checkout? "/a/b" "/a/b")
          (parcel-line-lib/foreign-checkout? "/a/b" "/a/c")
          (parcel-line-lib/foreign-checkout? "/a/b" nil)])

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
          outcome (atom nil)
          out (with-out-str (reset! outcome (parcel-line-lib/take-up! facts)))]
      (assert= "take-up! moves HEAD onto the cited commit" c (git wt "rev-parse" "HEAD"))
      (assert= "take-up! returns :moved after a move, for print-task's ACTION text" :moved @outcome)
      (assert= "the role branch is kept" "swarmforge-architect" (git wt "rev-parse" "--abbrev-ref" "HEAD"))
      (assert= "the old head is kept under a parcel-backup ref" true
               (str/includes? (git wt "for-each-ref" "--format=%(objectname)" "refs/swarmforge/parcel-backup/architect/") old))
      (assert= "take-up! reports the move" true (str/includes? out "PARCEL_LINE: moved"))
      ;; work on top is never moved back
      (let [mine (commit! wt "mine.txt" "m\n" "BL-9001: architect pass")
            stayed (with-out-str (assert= "take-up! returns :stay when it stays" :stay (parcel-line-lib/take-up! facts)))]
        (assert= "work on top is never moved back" mine (git wt "rev-parse" "HEAD"))
        (assert= "a stay prints nothing" "" stayed))
      ;; dirty tracked change blocks
      (git wt "checkout" "-q" "-B" "swarmforge-architect" old)
      (spit (str (fs/path wt "a.txt")) "dirty\n")
      (let [outcome (atom nil)
            out (with-out-str (reset! outcome (parcel-line-lib/take-up! facts)))]
        (assert= "a dirty worktree is not moved" old (git wt "rev-parse" "HEAD"))
        (assert= "a refused take-up returns :refused" :refused @outcome)
        (assert= "the blocked line names the file" true (str/includes? out "a.txt"))
        (assert= "the blocked line says not taken up" true (str/includes? out "not taken up")))
      (git wt "checkout" "-q" "--" "a.txt")
      ;; BL-1904: :own-root names the running role's roles.tsv worktree.
      (let [other (str (fs/path root "other"))
            _ (git root "worktree" "add" "-q" "-b" "swarmforge-QA" other old)
            refs-before (git root "for-each-ref" "--format=%(refname)" "refs/swarmforge/parcel-backup/")
            outcome (atom nil)
            out (with-out-str (reset! outcome (parcel-line-lib/take-up! (assoc facts :own-root other))))]
        (assert= "a checkout that is not the role's own is not moved" old (git wt "rev-parse" "HEAD"))
        (assert= "a foreign checkout's refusal returns :refused" :refused @outcome)
        (assert= "and its branch is kept" "swarmforge-architect" (git wt "rev-parse" "--abbrev-ref" "HEAD"))
        (assert= "no parcel-backup ref is written for it" refs-before
                 (git root "for-each-ref" "--format=%(refname)" "refs/swarmforge/parcel-backup/"))
        (assert= "the refusal says not taken up" true (str/includes? out "not taken up"))
        (assert= "the refusal names the checkout" true (str/includes? out wt))
        (assert= "the refusal is one PARCEL_LINE line" 1 (count (re-seq #"PARCEL_LINE:" out))))
      (let [out (with-out-str (parcel-line-lib/take-up! (assoc facts :own-root (str wt "/sub/.."))))]
        (assert= "the role's own worktree, spelled another way, still moves" c (git wt "rev-parse" "HEAD"))
        (assert= "and reports the move" true (str/includes? out "PARCEL_LINE: moved"))))
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

;; ── 2026-10-06: a merge naming no ticket, and a done ticket's commit, stay ──
;; The coder's BL-1843 line was force-moved six times on 2026-10-06 because
;; a default-subject merge (of main, or of a salvage ref) and a landed
;; ticket's commit read as foreign work.
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-lib-merge-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (fs/create-dirs (fs/path root "backlog" "done" "M8"))
    (spit (str (fs/path root "backlog" "done" "M8" "BL-9005-landed.yaml")) "id: BL-9005\n")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          _ (commit! wt "landed.txt" "l\n" "BL-9005: a done ticket's commit")
          _ (commit! wt "mine.txt" "m\n" "BL-9002: own unlanded work")
          _ (commit! root "main2.txt" "m2\n" "main moves on")
          _ (git root "update-ref" "refs/remotes/origin/main" "HEAD")
          _ (git wt "-c" "user.email=t@t" "-c" "user.name=t" "merge" "-q" "--no-edit" "--no-ff" "origin/main")
          head (git wt "rev-parse" "HEAD")
          facts {:root wt :role "coder" :project-root root :intent {:intent :start :ticket "BL-9002"}}]
      (with-out-str (parcel-line-lib/take-up! facts))
      (assert= "a no-ticket merge and a done ticket's commit beside the ticket's own work stay"
               head (git wt "rev-parse" "HEAD")))
    (finally (fs/delete-tree root))))

(let [root (str (fs/create-temp-dir {:prefix "parcel-line-lib-merge-only-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          _ (commit! wt "tmp.txt" "t\n" "unrelated scratch")
          _ (commit! root "main2.txt" "m2\n" "main moves on")
          _ (git root "update-ref" "refs/remotes/origin/main" "HEAD")
          _ (git wt "-c" "user.email=t@t" "-c" "user.name=t" "merge" "-q" "--no-edit" "--no-ff" "origin/main")
          main-sha (git root "rev-parse" "origin/main")
          facts {:root wt :role "coder" :project-root root :intent {:intent :start :ticket "BL-9002"}}]
      (with-out-str (parcel-line-lib/take-up! facts))
      (assert= "a line with a merge but no commit naming the ticket is not its own line; it restarts"
               main-sha (git wt "rev-parse" "HEAD")))
    (finally (fs/delete-tree root))))

;; ── BL-1887: a git_handoff at a commit already on origin/main starts fresh ──
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-1887-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (let [base (commit! root "a.txt" "a\n" "init")
          _ (git root "update-ref" "refs/remotes/origin/main" base)
          wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt base)
          other (commit! wt "o.txt" "o\n" "BL-9001: other ticket's unlanded work")
          route {:root wt :project-root root :role "coder"
                 :intent {:intent :take-up :commit base :ticket "BL-9002"}}]
      (with-out-str (parcel-line-lib/take-up! route))
      (assert= "BL-1887: a route at a main commit moves the line off another ticket's work"
               base (git wt "rev-parse" "HEAD"))
      (assert= "BL-1887: the head it left is backed up" true
               (str/includes? (git wt "for-each-ref" "--format=%(objectname)" "refs/swarmforge/parcel-backup/coder/") other))
      ;; the ticket's own unlanded work stays
      (let [own (commit! wt "n.txt" "n\n" "BL-9002: own work")]
        (with-out-str (parcel-line-lib/take-up! route))
        (assert= "BL-1887: a route at a main commit leaves the ticket's own line in place"
                 own (git wt "rev-parse" "HEAD")))
      ;; a build not on origin/main is still taken up
      (git wt "checkout" "-q" "-B" "swarmforge-coder" other)
      (git wt "checkout" "-q" "-b" "build" base)
      (let [build (commit! wt "b.txt" "b\n" "BL-9002: the build")]
        (git wt "checkout" "-q" "swarmforge-coder")
        (with-out-str (parcel-line-lib/take-up! (assoc-in route [:intent :commit] build)))
        (assert= "BL-1887: a build not on origin/main is taken up as before"
                 build (git wt "rev-parse" "HEAD"))))
    (finally (fs/delete-tree root))))

;; ── BL-1887: a route whose commit is on the REAL origin/main, but not yet
;; on this worktree's stale local tracking ref, still starts fresh after
;; resolve-target's one fetch. (hardener-found gap: deleting this whole
;; cond clause - the "fetch once and re-ask" branch - left every existing
;; suite green: the unit runner above, the 4/4 acceptance feature and the
;; property test all set up the local origin/main ref directly via
;; `update-ref`, so none of them ever exercises an ACTUAL git fetch. A
;; role whose worktree has not fetched recently is exactly the ordinary
;; case this branch exists for; without it, such a route silently falls
;; through to "take up as a build", carrying the previous ticket's
;; unlanded work forward - the very defect BL-1887 exists to close, just
;; gated behind a stale local ref instead of an absent one.)
(let [bare (str (fs/create-temp-dir {:prefix "parcel-line-1887-bare-"}))
      root (str (fs/create-temp-dir {:prefix "parcel-line-1887c-"}))]
  (try
    (git bare "init" "-q" "--bare" "-b" "main")
    (git root "init" "-q" "-b" "main")
    (let [base (commit! root "a.txt" "a\n" "init")]
      (git root "remote" "add" "origin" bare)
      (git root "push" "-q" "origin" "main")
      (let [wt (str (fs/path root "wt"))
            _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt base)
            other (commit! wt "o.txt" "o\n" "BL-9001: other ticket's unlanded work")
            ;; the route's own commit, built on a side branch so its object
            ;; is fetched into root's odb WITHOUT moving the local
            ;; refs/remotes/origin/main tracking ref.
            _ (git wt "checkout" "-q" "-b" "side" base)
            routed (commit! wt "n.txt" "n\n" "BL-9002: lands on the real origin meanwhile")
            _ (git wt "push" "-q" "origin" "side:refs/heads/side")
            _ (git root "fetch" "-q" "origin" "side")
            ;; origin/main lands routed AND one commit past it, so the
            ;; start-target path (origin/main's TIP) and the old take-up
            ;; path (the bare `commit` field, routed itself) land on
            ;; different shas - discriminating which path actually ran.
            ;; Pushed to a PARKING ref, never "main", so this push's own
            ;; local-tracking-ref update (git's documented post-push
            ;; behaviour) never touches root's origin/main ref either -
            ;; only the direct `update-ref` on the bare repo below does,
            ;; keeping root's tracking ref genuinely stale.
            _ (git root "checkout" "-q" "--detach" routed)
            later (commit! root "p.txt" "p\n" "BL-9100: landed just after, meanwhile")
            _ (git root "push" "-q" "origin" (str later ":refs/heads/parking"))
            _ (git bare "update-ref" "refs/heads/main" later)
            _ (git wt "checkout" "-q" "swarmforge-coder")]
        (assert= "the local tracking ref has not caught up yet" false
                 (= later (git root "rev-parse" "origin/main")))
        (with-out-str
          (parcel-line-lib/take-up!
           {:root wt :project-root root :role "coder"
            :intent {:intent :take-up :commit routed :ticket "BL-9002"}}))
        (assert= "BL-1887: a fetch during resolve-target reveals the route is on origin/main, so it starts fresh at the TIP, not merely the cited commit"
                 later (git wt "rev-parse" "HEAD"))
        (assert= "the foreign ticket's head it left is backed up" true
                 (str/includes? (git wt "for-each-ref" "--format=%(objectname)" "refs/swarmforge/parcel-backup/coder/") other))))
    (finally (fs/delete-tree bare) (fs/delete-tree root))))

;; ── BL-1887 scenario 04: a stale Work note after the send stays, even once origin/main moved ──
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-1887b-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (let [base (commit! root "a.txt" "a\n" "init")
          _ (git root "update-ref" "refs/remotes/origin/main" base)
          wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt base)
          sent (commit! wt "n.txt" "n\n" "BL-9002: sent on")
          ;; origin/main moves on after the line was cut
          _ (git root "checkout" "-q" "--detach" base)
          moved (commit! root "m.txt" "m\n" "BL-9100: landed meanwhile")
          _ (git root "update-ref" "refs/remotes/origin/main" moved)]
      (with-out-str (parcel-line-lib/take-up! {:root wt :project-root root :role "coder"
                                               :intent {:intent :start :ticket "BL-9002"}}))
      (assert= "BL-1887: a stale Work note leaves the ticket's own line in place after origin/main moved"
               sent (git wt "rev-parse" "HEAD")))
    (finally (fs/delete-tree root))))

;; ── BL-2044 D1 (QA bounce 587e17842f, routed to coder/hardener): a :take-up
;; of the role's OWN bounce parcel must never re-apply anything - the
;; candidate computation used to run on :take-up too (the intent map carries
;; :ticket whenever the forwarding git_handoff's task names one), so the
;; commonest bounce shape (a role idle on ticket X's line, handed X's own
;; bounce back - the parcel commit descends from the role's own current
;; HEAD) tried to cherry-pick a commit already present in the target: an
;; empty cherry-pick git reports as a conflict, wrongly refusing the bounce.
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-2044-takeup-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          own (commit! wt "own.txt" "o\n" "BL-9002: own work")
          side (str (fs/path root "side"))
          _ (git root "worktree" "add" "-q" "--detach" side own)
          bounce (commit! side "evidence.md" "D1\n" "BL-9002: QA review pass evidence (1 defect(s))")
          facts {:root wt :project-root root :role "coder"
                 :intent {:intent :take-up :commit bounce :ticket "BL-9002"}}
          outcome (atom nil)
          out (with-out-str (reset! outcome (parcel-line-lib/take-up! facts)))]
      (assert= "a :take-up of the role's own bounce parcel moves" :moved @outcome)
      (assert= "HEAD lands exactly on the bounce commit" bounce (git wt "rev-parse" "HEAD"))
      (assert= "nothing is re-applied on a :take-up (its target already IS the parcel)"
               false (str/includes? out "re-applied")))
    (finally (fs/delete-tree root))))

;; ── BL-2044 D2 (QA bounce 587e17842f): a commit naming ONLY a done ticket
;; (never the :start ticket itself) must not be re-applied across a forced
;; move - line-commit-ok? alone (the pre-D2 reapply-candidates filter) also
;; calls such a commit "the ticket's own" (every id is ticket-or-done, and
;; done-ticket's id alone satisfies that with ticket never mentioned at
;; all), so it was carried forward and conflicted with the done ticket's
;; landed REPLAY already on the target.
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-2044-done-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (fs/create-dirs (fs/path root "backlog" "done" "M8"))
    (spit (str (fs/path root "backlog" "done" "M8" "BL-9005-landed.yaml")) "id: BL-9005\n")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          _ (commit! wt "landed.txt" "l\n" "BL-9005: a done ticket's commit")
          ;; origin/main independently lands BL-9005's REPLAY (a fresh
          ;; commit with the same path/content, never the same sha) before
          ;; the coder is served BL-9002's Work note.
          _ (commit! root "landed.txt" "l\n" "Land BL-9005 (replay)")
          _ (git root "update-ref" "refs/remotes/origin/main" "HEAD")
          main-sha (git root "rev-parse" "origin/main")
          facts {:root wt :project-root root :role "coder" :intent {:intent :start :ticket "BL-9002"}}
          out (with-out-str (parcel-line-lib/take-up! facts))]
      (assert= "a line carrying only a done ticket's original commit is not BL-9002's own line; it moves"
               main-sha (git wt "rev-parse" "HEAD"))
      (assert= "the done ticket's original is not re-applied onto the replay already there"
               false (str/includes? out "re-applied")))
    (finally (fs/delete-tree root))))

;; ── BL-2044 D1 (ancestor-of-target filter): a candidate commit already
;; reachable from the move's own target must never be re-applied a second
;; time - here the ticket's own commit is already the ticket's newest
;; HANDED-OFF commit (recorded in another role's completed/ mailbox, per
;; BL-1887's newest-handoff-commit), so the :start target IS that exact
;; sha. Re-applying it again is the same empty-cherry-pick-reads-as-
;; conflict shape :take-up was wrongly exposed to (D1's second half, inside
;; reapply-candidates itself rather than the :start/:take-up scoping).
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-2044-ancestor-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          own (commit! wt "own.txt" "o\n" "BL-9002: own work")
          _ (commit! wt "other.txt" "o2\n" "BL-9000: another ticket's unlanded work")
          hold (str (fs/path root "hold"))]
      ;; a handoff mailbox recording the ticket's own commit as already
      ;; handed off downstream of the coder - so the :start target resolves
      ;; to that exact sha, not to origin/main.
      (fs/create-dirs (fs/path hold ".swarmforge" "handoffs" "inbox" "completed"))
      (spit (str (fs/path hold ".swarmforge" "roles.tsv"))
            (str "architect\tarchitect\t" hold "\t\t\t\ttask\n"))
      (spit (str (fs/path hold ".swarmforge" "handoffs" "inbox" "completed" "001.handoff"))
            (str "type: git_handoff\nto: hardener\ntask: BL-9002\ncommit: " own "\n"))
      (let [facts {:root wt :project-root hold :role "coder" :intent {:intent :start :ticket "BL-9002"}}
            out (with-out-str (parcel-line-lib/take-up! facts))]
        (assert= "the line moves onto the ticket's own newest handed-off commit"
                 own (git wt "rev-parse" "HEAD"))
        (assert= "the commit already an ancestor of the handed-off target is not re-applied a second time"
                 false (str/includes? out "re-applied"))))
    (finally (fs/delete-tree root))))

;; ── BL-2044 D2 (QA bounce 8e3a8ad3d0, D1): a BL-1887 route (:take-up at a
;; commit already on origin/main) must re-apply the ticket's own unlanded
;; commit even when the line ALSO carries another ticket's unlanded work -
;; QA's own probe case H-route (backlog/evidence/BL-2044-QA-20261007.md),
;; now a standing regression. The pre-D1 code gated re-apply on the intent
;; keyword alone ((= :start (:intent intent))), so this route - :take-up
;; intent, resolved via start-target just like a Work note - skipped the
;; re-apply and stranded "own" under the backup ref.
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-2044-route-reapply-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    ;; take-up!'s own cherry-pick commits with no -c override (unlike this
    ;; file's commit! helper), so this is the first fixture in this file
    ;; that needs a real, persistent committer identity - every earlier
    ;; case only exercises a :refused/no-reapply path where no cherry-pick
    ;; ever actually commits (same convention as the BL-2044 property
    ;; runner's own fixture setup).
    (git root "config" "user.email" "t@t")
    (git root "config" "user.name" "t")
    (git root "config" "commit.gpgsign" "false")
    (commit! root "a.txt" "a\n" "init")
    (fs/create-dirs (fs/path root "backlog" "active"))
    (let [route (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "Promote BL-9002: paused -> active for coder")
          _ (git root "update-ref" "refs/remotes/origin/main" "HEAD")
          wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          own (commit! wt "f.txt" "own\n" "BL-9002: own work")
          other (commit! wt "z.txt" "z\n" "BL-9003: z work (unlanded, other ticket)")
          facts {:root wt :project-root root :role "coder"
                 :intent {:intent :take-up :commit route :ticket "BL-9002"}}
          outcome (atom nil)
          out (with-out-str (reset! outcome (parcel-line-lib/take-up! facts)))]
      (assert= "a BL-1887 route re-applies the ticket's own commit, even over an unlanded other ticket's"
               :moved @outcome)
      (assert= "the re-applied commit's content lands on the new HEAD" true (fs/exists? (fs/path wt "f.txt")))
      (assert= "the other ticket's content does not" false (fs/exists? (fs/path wt "z.txt")))
      (assert= "the move reports one re-applied commit" true (str/includes? out "re-applied 1 commit(s)"))
      (assert= "the old head (both commits) is backed up" true
               (str/includes? (git wt "for-each-ref" "--format=%(objectname)" "refs/swarmforge/parcel-backup/coder/") other)))
    (finally (fs/delete-tree root))))

;; ── BL-2044 D2 (QA bounce 8e3a8ad3d0): the :start-move scope itself is
;; load-bearing - a plain :take-up at a commit NOT on origin/main must
;; never reapply anything, even when the line being left behind carries a
;; reapply-worthy commit, for the SAME ticket, that the forwarded commit
;; does not already contain. QA's own D2 finding: dropping (:start?
;; resolved) from the :move branch's guard (reverting to always computing
;; candidates whenever ticket+base are present) passes every
;; PRE-EXISTING case in this file unchanged, because none of them gives a
;; plain :take-up a reapply-worthy sibling commit to find. This one does.
(let [root (str (fs/create-temp-dir {:prefix "parcel-line-2044-scope-"}))]
  (try
    (git root "init" "-q" "-b" "main")
    (git root "config" "user.email" "t@t")
    (git root "config" "user.name" "t")
    (git root "config" "commit.gpgsign" "false")
    (commit! root "a.txt" "a\n" "init")
    (git root "update-ref" "refs/remotes/origin/main" "HEAD")
    (let [wt (str (fs/path root "wt"))
          _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
          own (commit! wt "own.txt" "o\n" "BL-9002: own earlier work")
          ;; a sibling build for the SAME ticket, built from origin/main
          ;; directly (never descended from "own") and never pushed to
          ;; origin/main - a plain forwarded git_handoff, never a BL-1887
          ;; route.
          _ (git wt "checkout" "-q" "-b" "build" "origin/main")
          build (commit! wt "build.txt" "b\n" "BL-9002: the build")
          _ (git wt "checkout" "-q" "swarmforge-coder")
          facts {:root wt :project-root root :role "coder"
                 :intent {:intent :take-up :commit build :ticket "BL-9002"}}
          outcome (atom nil)
          out (with-out-str (reset! outcome (parcel-line-lib/take-up! facts)))]
      (assert= "a plain take-up not on origin/main moves onto exactly the cited commit"
               build (git wt "rev-parse" "HEAD"))
      (assert= "the line's earlier own commit is never reapplied onto it" false (fs/exists? (fs/path wt "own.txt")))
      (assert= "no reapply is reported for a plain take-up" false (str/includes? out "re-applied")))
    (finally (fs/delete-tree root))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: parcel_line_lib.bb"))
