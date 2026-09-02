#!/usr/bin/env bb
;; TDD runner for land_step_lib.bb (BL-1241) - the land step's own remedy
;; for an entangled tip: detect which sibling tickets' unlanded work is an
;; ancestor, and (when any is) build a tip-pure replay commit off
;; origin/main, never a bounce to the parcel's author.

(ns land-step-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1241-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- mark-origin-main-here! [root]
  (sh! root "git" "update-ref" "refs/remotes/origin/main" (:out (sh! root "git" "rev-parse" "HEAD"))))

;; ── entangled-siblings ───────────────────────────────────────────────────

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: finds the sibling ticket" #{"BL-9002"} (:entangled result))
    (assert= "entangled-siblings: no warning on a clean read" nil (:warning result))))

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work only")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: empty when only the task's own commit is in range" #{} (:entangled result))))

(with-fixture [root]
  (mark-origin-main-here! root)
  ;; A commit naming no ticket at all (e.g. a bare bookkeeping/merge commit
  ;; with no attributable subject) never counts as entanglement - positive
  ;; identification only, task_scope_gate_lib.bb's own posture.
  (commit! root "unrelated.txt" "x\n" "unattributed bookkeeping commit")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: an unattributed commit is never counted as entanglement"
             #{} (:entangled result))))

;; ── own-paths ────────────────────────────────────────────────────────────

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/own-paths root commit "BL-9001")]
    (assert= "own-paths: excludes the unlanded sibling's own path, self-computing unlanded"
             ["backlog/active/BL-9001-x.yaml"] (:paths result))))

;; ── land-plan ────────────────────────────────────────────────────────────

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work only")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
    (assert= "land-plan: no entanglement -> :land" {:action :land} plan)))

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
    (assert= "land-plan: entanglement -> :replay" :replay (:action plan))
    (assert= "land-plan: names the sibling" #{"BL-9002"} (:entangled plan))
    (assert= "land-plan: own-paths is just the task's own file" ["backlog/active/BL-9001-x.yaml"] (:own-paths plan))))

(with-fixture [root]
  (let [plan (land-step-lib/land-plan {:root root :commit "deadbeef" :task-ticket-id nil})]
    (assert= "land-plan: no task ticket id -> :escalate" :escalate (:action plan))))

;; ── replay!: builds a real tip-pure commit, never touches the caller's
;;    own checkout ─────────────────────────────────────────────────────────

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        before-branch (:out (sh! root "git" "rev-parse" "--abbrev-ref" "HEAD"))
        before-status (:out (sh! root "git" "status" "--porcelain"))
        result (land-step-lib/replay! {:root root :commit commit :task-ticket-id "BL-9001"
                                        :own-paths ["backlog/active/BL-9001-x.yaml"]})]
    (assert-true "replay!: reports success" (:success result))
    (assert= "replay!: never moves the caller's own branch"
             before-branch (:out (sh! root "git" "rev-parse" "--abbrev-ref" "HEAD")))
    (assert= "replay!: never dirties the caller's own working tree"
             before-status (:out (sh! root "git" "status" "--porcelain")))
    (let [tip-paths (:out (sh! root "git" "diff-tree" "-r" "--no-commit-id" "--name-only" (:commit result)))]
      (assert= "replay!: the built commit contains ONLY the task's own path"
               "backlog/active/BL-9001-x.yaml" tip-paths))
    (let [parent (:out (sh! root "git" "rev-parse" (str (:commit result) "^")))
          origin-main (:out (sh! root "git" "rev-parse" "origin/main"))]
      (assert= "replay!: the built commit's parent is origin/main, not the entangled tip"
               origin-main parent))))

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        before-count (count (str/split-lines (:out (sh! root "git" "worktree" "list"))))
        _ (land-step-lib/replay! {:root root :commit commit :task-ticket-id "BL-9001"
                                   :own-paths ["backlog/active/BL-9001-x.yaml"]})
        after-count (count (str/split-lines (:out (sh! root "git" "worktree" "list"))))]
    (assert= "replay!: no extra worktree left registered after a successful replay"
             before-count after-count)))

;; ── BL-1298: the replay runs from the worktree the caller is actually in ──
;; `.git` is a DIRECTORY only in the main checkout. In a linked worktree - the
;; only place a pipeline role ever works - it is a FILE holding `gitdir: ...`,
;; so a scratch path built from `<root>/.git` names a child of a regular file
;; and `git worktree add` fails outright. The replay must ask git where the
;; real git directory is, and answer the same from either checkout.

(defn- linked-worktree! [root]
  (let [wt (str (fs/path root "linked-wt"))]
    (sh! root "git" "worktree" "add" "-q" "--detach" wt "HEAD")
    wt))

(defn- scratch-path-for [root task-ticket-id commit]
  (str (fs/path root ".git" "land-replay-worktrees"
                (str task-ticket-id "-" (subs commit 0 10)))))

(defn- replay-branch-for [task-ticket-id commit]
  (str "land-replay/" task-ticket-id "-" (subs commit 0 10)))

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        wt (linked-worktree! root)
        from-linked (land-step-lib/replay! {:root wt :commit commit :task-ticket-id "BL-9001"
                                            :own-paths ["backlog/active/BL-9001-x.yaml"]})]
    (assert-true "replay!: succeeds when invoked from a linked worktree"
                 (:success from-linked))
    (when (:success from-linked)
      (assert= "replay!: a linked worktree replays exactly the ticket's own paths"
               "backlog/active/BL-9001-x.yaml"
               (:out (sh! root "git" "diff-tree" "-r" "--no-commit-id" "--name-only"
                          (:commit from-linked))))
      (assert= "replay!: a linked worktree replays onto origin/main"
               (:out (sh! root "git" "rev-parse" "origin/main"))
               (:out (sh! root "git" "rev-parse" (str (:commit from-linked) "^")))))
    ;; Same ticket, same commit, other checkout: the answer must not depend on
    ;; which one asked. Compared by TREE, not by sha - the two commits are
    ;; distinct objects only because they are made at different seconds.
    (sh! root "git" "branch" "-q" "-D" (replay-branch-for "BL-9001" commit))
    (let [from-main (land-step-lib/replay! {:root root :commit commit :task-ticket-id "BL-9001"
                                            :own-paths ["backlog/active/BL-9001-x.yaml"]})]
      (assert-true "replay!: succeeds from the main checkout too" (:success from-main))
      (when (and (:success from-linked) (:success from-main))
        (assert= "replay!: the two checkouts produce the same replayed tree"
                 (:out (sh! root "git" "rev-parse" (str (:commit from-main) "^{tree}")))
                 (:out (sh! root "git" "rev-parse" (str (:commit from-linked) "^{tree}"))))))))

;; A failed attempt is not free: `git worktree add -b` creates the branch even
;; when it then fails to make the checkout (verified against git directly), and
;; the create failure path returned without deleting it. The next attempt then
;; failed with "branch already exists" - a DIFFERENT reason from the first, so
;; whoever read the second message was sent chasing the wrong defect.

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        scratch (scratch-path-for root "BL-9001" commit)
        branch (replay-branch-for "BL-9001" commit)]
    ;; A regular FILE where the scratch checkout must go: `worktree add` cannot
    ;; create it, which is the create-failure path under test.
    (fs/create-dirs (fs/parent scratch))
    (spit scratch "not a directory\n")
    (let [result (land-step-lib/replay! {:root root :commit commit :task-ticket-id "BL-9001"
                                          :own-paths ["backlog/active/BL-9001-x.yaml"]})]
      (assert= "replay!: a scratch checkout that cannot be created is a failure"
               false (:success result))
      (assert-includes "replay!: the failure names the scratch checkout"
                       (:reason result) "could not create worktree")
      (assert= "replay!: a failed create leaves no scratch branch behind"
               "" (:out (sh! root "git" "branch" "--list" branch))))))

;; Scenario 03: once the first attempt's reason is gone, so is the failure. A
;; leaked branch would make the retry fail for its own reason instead.

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        scratch (scratch-path-for root "BL-9001" commit)
        args {:root root :commit commit :task-ticket-id "BL-9001"
              :own-paths ["backlog/active/BL-9001-x.yaml"]}]
    (fs/create-dirs (fs/parent scratch))
    (spit scratch "not a directory\n")
    (let [first-attempt (land-step-lib/replay! args)]
      (assert= "replay!: the first attempt fails" false (:success first-attempt))
      (fs/delete-if-exists scratch)
      (let [retry (land-step-lib/replay! args)]
        (assert-true "replay!: the retry succeeds once the first attempt's reason is gone"
                     (:success retry))
        (assert= "replay!: a retry never fails for a branch the first attempt leaked"
                 nil (:reason retry))))))

;; ── entanglement-note ────────────────────────────────────────────────────

(let [msg (land-step-lib/entanglement-note "BL-9001-fixture" #{"BL-9002" "BL-9003"})]
  (assert-includes "entanglement-note: names the task" msg "BL-9001-fixture")
  (assert-includes "entanglement-note: names a sibling" msg "BL-9002")
  (assert-includes "entanglement-note: names the other sibling" msg "BL-9003"))

;; ── BL-1272: a landed sibling is not reported as entangled ───────────────
;; A tip-pure replay lands as a NEW commit object, so landing a sibling's
;; replay does not remove that sibling's ORIGINAL commit from the ancestry of
;; the next parcel cited at the same original tip. The report must stop naming
;; it - but only on POSITIVE evidence its content is already on origin/main.

;; sibling-landed? is pure over the injected facts, so every fail-closed row
;; is pinned without a corrupted repository.
(assert= "sibling-landed?: byte-identical attributed content -> landed"
         true
         (land-step-lib/sibling-landed? {:paths ["a.txt"] :complete? true :same-content? (constantly true)}))
(assert= "sibling-landed?: a differing path -> not landed"
         false
         (land-step-lib/sibling-landed? {:paths ["a.txt"] :complete? true :same-content? (constantly false)}))
(assert= "sibling-landed?: partially present -> not landed"
         false
         (land-step-lib/sibling-landed? {:paths ["a.txt" "b.txt"] :complete? true
                                         :same-content? #(= % "a.txt")}))
(assert= "sibling-landed?: an unreadable walk (nil paths) -> not landed, never silently landed"
         false
         (land-step-lib/sibling-landed? {:paths nil :complete? true :same-content? (constantly true)}))
(assert= "sibling-landed?: no attributed paths at all -> not landed (absence is not evidence)"
         false
         (land-step-lib/sibling-landed? {:paths [] :complete? true :same-content? (constantly true)}))

;; The fail-open shape the completeness probe exists to close: the attribution
;; walk yields FEWER paths when one commit's diff cannot be computed, and the
;; half it did see is already on origin/main.
(assert= "sibling-landed?: a partial attribution walk -> not landed, however identical what it saw"
         false
         (land-step-lib/sibling-landed? {:paths ["a.txt"] :complete? false
                                         :same-content? (constantly true)}))

;; landed-siblings against a real repository: the sibling's file is already on
;; origin/main, byte-identical, while its ORIGINAL commit is still an ancestor.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "sib.txt" "sibling content\n" "BL-9002: sibling work")
  (commit! root "own.txt" "own content\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))]
    ;; Land the sibling's CONTENT on origin/main as a different commit object,
    ;; exactly as a tip-pure replay does.
    (sh! root "git" "checkout" "-q" "-b" "landing" (:out (sh! root "git" "rev-parse" "refs/remotes/origin/main")))
    (commit! root "sib.txt" "sibling content\n" "BL-9002: sibling work (replayed tip-pure)")
    (mark-origin-main-here! root)
    (sh! root "git" "checkout" "-q" "main")
    (let [origin-main (land-step-lib/origin-main-sha root)]
      (assert= "landed-siblings: a sibling already byte-identical on origin/main is landed"
               #{"BL-9002"}
               (land-step-lib/landed-siblings root commit origin-main
                                              (str/split-lines (:out (sh! root "git" "rev-list" "--first-parent" (str origin-main ".." commit))))
                                              #{"BL-9002"}))
      (let [result (land-step-lib/entangled-siblings root commit "BL-9001")]
        (assert= "entangled-siblings: the sibling is still in :entangled (the decision is unchanged)"
                 #{"BL-9002"} (:entangled result))
        (assert= "entangled-siblings: and is reported as landed" #{"BL-9002"} (:landed result))
        (assert= "entangled-siblings: so nothing is left to adjudicate" #{} (:unlanded result)))
      (let [plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
        (assert= "land-plan: the action is UNCHANGED when the sibling has landed" :replay (:action plan))
        (assert= "land-plan: and it carries the landed sibling" #{"BL-9002"} (:landed plan))
        (assert= "land-plan: and names nothing to adjudicate" #{} (:unlanded plan))))))

;; The same fixture with the sibling's content NOT on origin/main: still
;; entangled, still adjudicable - the check did not get looser.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "sib.txt" "sibling content\n" "BL-9002: sibling work")
  (commit! root "own.txt" "own content\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: an unlanded sibling is not reported as landed" #{} (:landed result))
    (assert= "entangled-siblings: and stays adjudicable" #{"BL-9002"} (:unlanded result))))

;; A subject grep would call this landed; a content check must not. origin/main
;; carries a commit NAMING the sibling (a mint or spec commit) while the
;; sibling's actual work is still unlanded.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "sib.txt" "sibling content\n" "BL-9002: sibling work")
  (commit! root "own.txt" "own content\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))]
    (sh! root "git" "checkout" "-q" "-b" "minting" (:out (sh! root "git" "rev-parse" "refs/remotes/origin/main")))
    (commit! root "backlog/paused/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: mint the ticket")
    (mark-origin-main-here! root)
    (sh! root "git" "checkout" "-q" "main")
    (let [result (land-step-lib/entangled-siblings root commit "BL-9001")]
      (assert= "entangled-siblings: a mere mint naming the sibling never counts as landed"
               #{} (:landed result))
      (assert= "entangled-siblings: the real entanglement survives a subject match on origin/main"
               #{"BL-9002"} (:unlanded result)))))

;; ── BL-1308: a sibling reachable only through a merge's SECOND parent ─────
;; The detector's candidate walk must cover every commit the replay's
;; own-path diff can draw content from. `own-commit-changed-paths` reads a
;; merge against its FIRST parent, so it pulls in everything that merge's
;; second parent carried - regardless of who authored it. A detector that
;; walked --first-parent never saw those commits, so a sibling riding in on
;; the second parent entered the replay while its id never reached the
;; report.

(with-fixture [root]
  (mark-origin-main-here! root)
  (sh! root "git" "checkout" "-q" "-b" "bl1308-sibling")
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (sh! root "git" "checkout" "-q" "main")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  ;; The forward-merge shape: its subject names the CITED ticket, and the
  ;; sibling's commits arrive on the second parent under their own subjects.
  (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9001: forward merge" "bl1308-sibling")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: names a sibling reachable only via a merge's second parent"
             #{"BL-9002"} (:entangled result))
    (assert= "entangled-siblings: that sibling is reported as unlanded"
             #{"BL-9002"} (:unlanded result))
    (assert= "entangled-siblings: no warning on a clean read of a merge ancestry"
             nil (:warning result))))

;; Invariant 1, at the decision: every ticket whose content the replay tip
;; would add over origin/main is named in the same run's report.
(with-fixture [root]
  (mark-origin-main-here! root)
  (sh! root "git" "checkout" "-q" "-b" "bl1308-sibling2")
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (sh! root "git" "checkout" "-q" "main")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9001: forward merge" "bl1308-sibling2")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
    (assert= "land-plan: a second-parent sibling forces the tip-pure replay" :replay (:action plan))
    (assert= "land-plan: and names it" #{"BL-9002"} (:entangled plan))))

;; A first-parent sibling is still found - widening the walk adds coverage,
;; it never trades one blind spot for another.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9003-x.yaml" "id: BL-9003\n" "BL-9003: first-parent sibling")
  (sh! root "git" "checkout" "-q" "-b" "bl1308-sibling3")
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: second-parent sibling")
  (sh! root "git" "checkout" "-q" "main")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9001: forward merge" "bl1308-sibling3")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: both walks' siblings are named"
             #{"BL-9002" "BL-9003"} (:entangled result))))

;; entanglement-note names only what is left to adjudicate.
(let [msg (land-step-lib/entanglement-note "BL-9001-fixture" #{})]
  (assert-includes "entanglement-note: says so when every sibling already landed" msg "already landed")
  (assert-includes "entanglement-note: still names the task" msg "BL-9001-fixture"))

;; ── BL-1315: own-paths adds only the landed ticket's own content, on the
;;    FULL origin/main..tip range rather than the tagged merge's first-
;;    parent diff - both faces (over- and under-inclusion) ────────────────

;; 01: an unlanded sibling's own content, reachable only via the tagged
;; merge's second parent, is dropped - but the landed ticket's own path
;; survives (the over-inclusion face, BL-1307/BL-1300 and BL-1298/BL-1303).
(with-fixture [root]
  (mark-origin-main-here! root)
  (sh! root "git" "checkout" "-q" "-b" "bl1315-01-sibling")
  (commit! root "sib.txt" "sibling content\n" "BL-9002: sibling unlanded work")
  (sh! root "git" "checkout" "-q" "main")
  (commit! root "own.txt" "own content\n" "BL-9001: own work")
  (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9001: forward merge" "bl1315-01-sibling")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})
        paths (set (:paths result))]
    (assert= "own-paths (01): drops the unlanded sibling's own path" false (contains? paths "sib.txt"))
    (assert= "own-paths (01): keeps the landed ticket's own path" true (contains? paths "own.txt"))))

;; 02a: a sibling already landed on origin/main is not subtracted - its
;; content was never in the delivered diff to begin with, so the tip stays
;; the full delivered set even if a caller (wrongly) still names it unlanded.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "sib.txt" "sibling content\n" "BL-9002: sibling work")
  (commit! root "own.txt" "own content\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))]
    (sh! root "git" "checkout" "-q" "-b" "bl1315-02a-landing" (:out (sh! root "git" "rev-parse" "refs/remotes/origin/main")))
    (commit! root "sib.txt" "sibling content\n" "BL-9002: sibling work (replayed tip-pure)")
    (mark-origin-main-here! root)
    (sh! root "git" "checkout" "-q" "main")
    (let [full (:out (sh! root "git" "diff" "--name-only" "origin/main" commit))
          full-paths (set (remove str/blank? (str/split-lines full)))
          result (land-step-lib/own-paths root commit "BL-9001" #{})
          result-mistaken (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})]
      (assert= "own-paths (02a): unchanged from the full delivered set once the sibling has landed"
               full-paths (set (:paths result)))
      (assert= "own-paths (02a): still unchanged even if the landed sibling is (mistakenly) passed as unlanded"
               full-paths (set (:paths result-mistaken))))))

;; 02b: a sibling that rewrites a path back to origin/main's own content is
;; byte-identical - never entering the delivered diff, so nothing to subtract.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "shared.txt" "same content\n" "seed the shared file")
  (mark-origin-main-here! root)
  (commit! root "shared.txt" "same content\n" "BL-9002: sibling rewrites shared with identical content")
  (commit! root "own.txt" "own content\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})]
    (assert= "own-paths (02b): a byte-identical sibling path is not in the delivered set to begin with"
             ["own.txt"] (:paths result))))

;; 03: every role's contribution to the landed ticket survives, even a path
;; whose own commit names no ticket at all - only the forward-merge does.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "coder.txt" "impl\n" "coder: implement the feature")
  (commit! root "hardener.txt" "hardened\n" "hardener: add coverage")
  (sh! root "git" "checkout" "-q" "-b" "bl1315-03-sibling")
  (commit! root "sib.txt" "sibling\n" "BL-9002: sibling unlanded work")
  (sh! root "git" "checkout" "-q" "main")
  (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9001: documenter forward merge" "bl1315-03-sibling")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})
        paths (set (:paths result))]
    (assert= "own-paths (03): keeps coder's path though only the forward-merge names the ticket"
             true (contains? paths "coder.txt"))
    (assert= "own-paths (03): keeps hardener's path though only the forward-merge names the ticket"
             true (contains? paths "hardener.txt"))
    (assert= "own-paths (03): still drops the unlanded sibling's path"
             false (contains? paths "sib.txt"))))

;; 04: an undeterminable attribution refuses rather than narrows - driven via
;; an injected commits-fn so the unreadable row is pinned without corrupting
;; a real repository (the same posture landed-siblings' paths-fn takes).
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "own.txt" "own content\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        unreadable-fn (fn [_root _origin-main _commit _path] nil)
        result (land-step-lib/own-paths root commit "BL-9001" #{} unreadable-fn)]
    (assert= "own-paths (04): an unreadable attribution refuses rather than narrows" nil (:paths result))
    (assert-includes "own-paths (04): the refusal names the affected path" (:warning result) "own.txt")))

;; 05: a tip with no entangled sibling is untouched - own-paths returns
;; exactly the full delivered set.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "a.txt" "a\n" "BL-9001: part one")
  (commit! root "b.txt" "b\n" "BL-9001: part two")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        full (:out (sh! root "git" "diff" "--name-only" "origin/main" commit))
        full-paths (set (remove str/blank? (str/split-lines full)))
        result (land-step-lib/own-paths root commit "BL-9001" #{})]
    (assert= "own-paths (05): unchanged from the full delivered set with no entangled sibling"
             full-paths (set (:paths result)))))

;; 06: content that reached the branch on an EARLIER sibling's merge still
;; lands, even though the ticket's own tagged commit adds nothing over its
;; first parent - the under-inclusion face (BL-1303's QA tip ab8d10a8b3).
(with-fixture [root]
  (mark-origin-main-here! root)
  (sh! root "git" "checkout" "-q" "-b" "bl1315-06-own-work")
  (commit! root "own.txt" "own content\n" "BL-9001: own work")
  (sh! root "git" "checkout" "-q" "main")
  (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9002: earlier sibling merge carries own work along" "bl1315-06-own-work")
  (sh! root "git" "commit" "-q" "--allow-empty" "-m" "BL-9001: own ticket-tagged forward, nothing new")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        first-parent-delivered (task-scope-gate-lib/own-commit-changed-paths root commit :delivered)
        result (land-step-lib/own-paths root commit "BL-9001" #{})]
    (assert= "own-paths (06): the ticket-tagged commit itself adds nothing over its first parent (the premise)"
             [] first-parent-delivered)
    (assert= "own-paths (06): the ticket's own content still lands, though it arrived on an earlier sibling merge"
             true (contains? (set (:paths result)) "own.txt"))))

;; 07: HARDENING FINDING (BL-1315) - a path touched by BOTH an unlanded
;; sibling's TAGGED commit and a later UNTAGGED own-chain commit is wrongly
;; dropped. `path-owner-tickets` runs every touching commit through
;; `commit-ticket-id` and `keep`s only the non-nil results - so an untagged
;; commit's touch on a path contributes NOTHING to `owners`, and the
;; exclusion cond then sees only the sibling's id and reads "every owner is
;; unlanded" even though an own, untagged commit also touched the same
;; path. This is the same shape as scenario 03 (an untagged own commit
;; must never cause a drop) except the path is SHARED with a sibling
;; instead of exclusive to the own chain - a combination no existing
;; scenario or property-test fixture exercises (own and sibling paths are
;; always disjoint filenames elsewhere in this suite and in
;; bl1315OwnPathsFullRangeInvariants.property.test.js's generator).
(with-fixture [root]
  (mark-origin-main-here! root)
  (sh! root "git" "checkout" "-q" "-b" "bl1315-07-sibling")
  (commit! root "shared.txt" "sibling content\n" "BL-9002: sibling creates shared file")
  (sh! root "git" "checkout" "-q" "main")
  (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9001: forward merge (brings in sibling)" "bl1315-07-sibling")
  (commit! root "shared.txt" "own content on top of the sibling's\n" "coder: refine shared.txt further (no ticket tag)")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})]
    (assert= "own-paths (07): a shared path with a later untagged own edit atop an unlanded sibling's touch is never dropped (invariant 1)"
             true (contains? (set (:paths result)) "shared.txt"))))

;; ── BL-1334: the land step records the replay->approved-source mapping ─────
;; The land step publishes a tip-pure replay to main and does not advance
;; swarmforge-QA, so QA's own approved work reads as unapproved at the instant
;; it lands. Human ruling: record the mapping for the predicate to consult
;; rather than let a script write the ref that DEFINES approval.

(with-fixture [root]
  (let [written (land-step-lib/record-land-approval!
                 {:root root :commit "abcdef0123456789" :source "0123456789abcdef"
                  :task-ticket-id "BL-9001"})
        store (str (fs/path root ".swarmforge" "land-approvals"))
        files (when (fs/exists? store) (mapv str (fs/list-dir store)))
        content (when (seq files) (slurp (first files)))]
    (assert-true "record-land-approval! reports success" (:ok? written))
    (assert= "record-land-approval! writes exactly one store file" 1 (count files))
    (assert-includes "the record names the replay commit" content "\"commit\":\"abcdef0123\"")
    (assert-includes "the record names the approved source" content "\"source\":\"0123456789\"")
    (assert-includes "the record names the ticket, so a reader can audit it" content "\"ticket\":\"BL-9001\"")
    (assert-includes "the record is stamped with when it was written" content "\"at\":\"")))

(with-fixture [root]
  ;; Appends, never truncates: a second land must not erase the first, or the
  ;; predicate stops approving everything landed earlier this month.
  (land-step-lib/record-land-approval!
   {:root root :commit "1111111111aaaa" :source "2222222222bbbb" :task-ticket-id "BL-9001"})
  (land-step-lib/record-land-approval!
   {:root root :commit "3333333333cccc" :source "4444444444dddd" :task-ticket-id "BL-9002"})
  (let [store (str (fs/path root ".swarmforge" "land-approvals"))
        content (str/join "\n" (mapv slurp (mapv str (fs/list-dir store))))]
    (assert-includes "the first land's record survives a second land" content "1111111111")
    (assert-includes "the second land's record is present too" content "3333333333")
    (assert= "one record line per land" 2
             (count (remove str/blank? (str/split-lines content))))))

(with-fixture [root]
  ;; A record with no source resolves to nothing and would read as a corrupt
  ;; line to the predicate, which fails CLOSED - so refuse to write one.
  (let [written (land-step-lib/record-land-approval!
                 {:root root :commit "abcdef0123456789" :source nil :task-ticket-id "BL-9001"})]
    (assert= "record-land-approval! refuses a record with no source" false (:ok? written))
    (assert= "refusing writes no store at all" false
             (fs/exists? (str (fs/path root ".swarmforge" "land-approvals"))))))

;; ── BL-1343: the replay never drops the landing ticket's own path ────────
;; The BL-1338 shape: the landing ticket's whole contribution is attributed
;; to unlanded siblings and subtracted, leaving an empty replay set that the
;; land step then reports as "nothing to commit" - the same words a genuinely
;; already-landed ticket produces. The exclusion must speak instead.

;; scenario 01: a path only the landing ticket introduced is replayed.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "specs/pipeline/steps/bl9001Steps.js" "// own\n" "BL-9001: its own new handler")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        {:keys [paths warning]} (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})]
    (assert= "BL-1343/01: the landing ticket's own new path is replayed" true
             (boolean (some #{"specs/pipeline/steps/bl9001Steps.js"} paths)))
    (assert= "BL-1343/01: and that is not a refusal" nil warning)))

;; scenario 02: a path attributed to nobody is still replayed.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "docs/untagged.md" "x\n" "housekeeping with no ticket in the subject")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        {:keys [paths warning]} (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})]
    (assert= "BL-1343/02: a path attributed to nobody is still replayed" true
             (boolean (some #{"docs/untagged.md"} paths)))
    (assert= "BL-1343/02: and that is not a refusal" nil warning)))

;; scenario 03: the landing ticket's contribution is never subtracted in
;; silence - this is the BL-1338 reproduction, and it FAILS before the fix.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "specs/pipeline/steps/bl9001Steps.js" "// own\n" "BL-9002: sibling commit that also carries BL-9001's file")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        {:keys [paths warning]} (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})]
    (assert= "BL-1343/03: an exclusion that empties the contribution refuses" nil paths)
    (assert-includes "BL-1343/03: the refusal names the path" warning "specs/pipeline/steps/bl9001Steps.js")
    (assert-includes "BL-1343/03: the refusal names the landing ticket" warning "BL-9001")
    (assert-includes "BL-1343/03: the refusal names the sibling" warning "BL-9002")))

;; scenario 04: an empty replay set is a refusal whenever the tip still
;; differs from origin/main - and the land step's own decision escalates.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "specs/pipeline/steps/bl9001Steps.js" "// own\n" "BL-9002: sibling commit carrying it")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
    (assert= "BL-1343/04: an empty replay set on a differing tip escalates" :escalate (:action plan))
    (assert-includes "BL-1343/04: and says which path it would have dropped"
                     (:reason plan) "specs/pipeline/steps/bl9001Steps.js")))

;; scenario 05: an empty set on an IDENTICAL tip is a real answer, not a
;; refusal. The negative case that matters most (qa_e2e_procedure step 3):
;; the silent no-op must not be traded for a land step that cannot finish.
(with-fixture [root]
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling work already on main")
  (mark-origin-main-here! root)
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        {:keys [paths warning]} (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})]
    (assert= "BL-1343/05: an identical tip answers with an empty set" [] paths)
    (assert= "BL-1343/05: and does not refuse" nil warning)))

;; scenario 06: unreadable attribution still refuses rather than narrowing
;; (BL-1272's posture, unchanged by this ticket).
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "specs/pipeline/steps/bl9001Steps.js" "// own\n" "BL-9001: own new handler")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        {:keys [paths warning]} (land-step-lib/own-paths
                                 root commit "BL-9001" #{"BL-9002"}
                                 (fn [_ _ _ _] nil))]
    (assert= "BL-1343/06: an unreadable attribution refuses" nil paths)
    (assert-includes "BL-1343/06: and names what it could not read" warning "attribution")))

;; A partial exclusion is still silent-safe: when the landing ticket keeps
;; SOME contribution, a genuinely sibling-owned path is excluded as before -
;; the refusal is scoped to an exclusion that would empty the set, so
;; tip-pure replay keeps working (BL-1272/BL-1241 untouched).
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "sibling/only.txt" "s\n" "BL-9002: sibling-only path")
  (commit! root "own/file.txt" "o\n" "BL-9001: own path")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        {:keys [paths warning]} (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})]
    (assert= "a sibling-only path is still excluded when the ticket keeps its own"
             ["own/file.txt"] paths)
    (assert= "and a partial exclusion is not a refusal" nil warning)))

;; ── report ─────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: land_step_lib.bb"))
