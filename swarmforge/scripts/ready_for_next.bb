#!/usr/bin/env bb

(ns ready-for-next
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "dispatch_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "reference_freshness_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "supersede_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "worktree_drift_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "branch_identity_guard_lib.bb")))


;; BL-640: pre-turn freshness guard. ready_for_next.sh is the one entry
;; point every role (task or batch mode, any pack) uses to start a turn
;; (constitution Article 2.4) - the "stage start" the specifier bound this
;; ticket's mechanism to. Runs BEFORE dispatch decides task vs batch, so a
;; stale worktree refuses uniformly regardless of what dispatch would have
;; done (dequeue, resume, NO_TASK, ROTATE_HOME). Degrades to a silent pass
;; on any git hiccup (no main ref, no reference/ dir, git missing) - it only
;; ever refuses when it can positively name real drift.
(defn- worktree-reference-shas [root]
  (let [dir (fs/path root reference-freshness-lib/reference-dir-rel)]
    (if (fs/exists? dir)
      (into {}
            (for [f (fs/list-dir dir)
                  :when (fs/regular-file? f)]
              [(str reference-freshness-lib/reference-dir-rel "/" (fs/file-name f))
               (reference-freshness-lib/sha256-hex (slurp (str f)))]))
      {})))

;; BL-640 D2 (architect bounce 20260818): this repo's QA lands its approved
;; commit by pushing HEAD:main straight to origin (QA's own worktree can't
;; fast-forward the shared local main, since another worktree already has
;; it checked out) - local main only catches up later, whenever the master
;; checkout next merges it in. In that window origin/main can carry a
;; landed reference/ amendment local main does not yet have, and the
;; workflow rule "A Prior QA Bounce Is Not In Your Worktree" documents that
;; the direction can flip - so neither ref alone is trustworthy.
;;
;; BL-1266: a whole-repo ahead-count is not an answer to "which ref carries
;; the newer version of THIS file" - origin/main can be 200 commits ahead
;; without touching reference/ at all, while local main carries the one
;; commit that did. Stop picking a single ref; consult every ref that
;; exists (local main always, origin/main only when this repo has one - no
;; remote configured, e.g. this guard's own unit fixtures, means main
;; alone).
(defn- candidate-refs [root]
  (into ["main"]
        (when (zero? (:exit (sh/sh "git" "-C" (str root) "rev-parse" "--verify" "--quiet" "origin/main")))
          ["origin/main"])))

(defn- ref-reference-shas [root ref]
  (let [list-result (sh/sh "git" "-C" (str root) "ls-tree" "-r" "--name-only" ref
                            "--" reference-freshness-lib/reference-dir-rel)]
    (if (zero? (:exit list-result))
      (into {}
            (keep (fn [path]
                    (when-not (str/blank? path)
                      (let [show-result (sh/sh "git" "-C" (str root) "show" (str ref ":" path))]
                        (when (zero? (:exit show-result))
                          [path (reference-freshness-lib/sha256-hex (:out show-result))]))))
                  (str/split-lines (:out list-result))))
      {})))

;; BL-1237: does this worktree's own HEAD already contain `ref`'s most
;; recent commit touching `path`? true means a content difference is the
;; worktree's OWN newer work laid on top of an amendment it has already
;; merged - not drift. Degrades to false (fail-closed, refuse) on any git
;; hiccup - no commit found, or the ancestry check itself errors - so a
;; missing answer never turns into a silent allow.
(defn- path-ancestry-absorbed? [root ref path]
  (let [log-result (sh/sh "git" "-C" (str root) "log" "-1" "--format=%H" ref "--" path)]
    (if (and (zero? (:exit log-result)) (not (str/blank? (str/trim (:out log-result)))))
      (let [commit (str/trim (:out log-result))
            anc-result (sh/sh "git" "-C" (str root) "merge-base" "--is-ancestor" commit "HEAD")]
        (zero? (:exit anc-result)))
      false)))

(defn- enforce-reference-freshness-guard! []
  (let [root (dispatch-lib/git-root)]
    (when root
      (let [worktree-shas (worktree-reference-shas root)
            refs-shas (into {} (map (fn [ref] [ref (ref-reference-shas root ref)]) (candidate-refs root)))
            absorbed (into {}
                           (for [[ref shas] refs-shas
                                 [path sha] shas
                                 :when (not= sha (get worktree-shas path))]
                             [[ref path] (path-ancestry-absorbed? root ref path)]))
            stale (reference-freshness-lib/stale-paths-multi-ref worktree-shas refs-shas absorbed)]
        (when (seq stale)
          (dispatch-lib/exit! 2 (reference-freshness-lib/staleness-report-multi-ref stale)))))))

(enforce-reference-freshness-guard!)

;; BL-1084: pre-turn supersede guard. Same posture as BL-640 — runs BEFORE
;; dispatch decides task vs batch, so a recorded supersede stops every stage
;; that next picks up a parcel for that task, not only the role a note reached.
;; Function name must contain "supersede" (required_wiring).
(defn- load-supersede-store [root]
  (let [dir (fs/path root supersede-lib/store-dir-rel)]
    (cond
      (not (fs/exists? dir))
      {:status :absent}

      (not (fs/directory? dir))
      {:status :unreadable :detail (str supersede-lib/store-dir-rel " exists but is not a directory")}

      :else
      (try
        (let [files (for [f (fs/list-dir dir)
                          :when (fs/regular-file? f)]
                      (try
                        {:name (fs/file-name f) :readable? true :body (slurp (str f))}
                        (catch Exception _
                          {:name (fs/file-name f) :readable? false :body nil})))]
          (supersede-lib/entries-from-files files))
        (catch Exception e
          {:status :unreadable :detail (.getMessage e)})))))

(defn- peek-candidate-task-names
  "Task names on parcels this role already holds (in_process) or would next
   dequeue (new/). Does not move or claim anything."
  [_role-name]
  (let [in-proc (handoff-lib/my-mailbox-dir :in_process)
        new-dir (handoff-lib/my-mailbox-dir :new)
        files (concat (handoff-lib/my-handoff-files in-proc)
                      (handoff-lib/my-handoff-files new-dir))]
    (->> files
         (keep (fn [f]
                 (try (supersede-lib/task-name-from-content (slurp (str f)))
                      (catch Exception _ nil))))
         (remove str/blank?)
         vec)))

(defn- enforce-supersede-guard! []
  ;; Store lives on the shared project root (roles.tsv home), not a
  ;; worktree-local .swarmforge — every stage must see the same marker.
  (let [root (dispatch-lib/project-root)
        role-name (dispatch-lib/role)
        store (load-supersede-store root)
        tasks (peek-candidate-task-names role-name)
        verdict (supersede-lib/turn-verdict store tasks)]
    (when (and (map? verdict) (= :refused (:status verdict)))
      (dispatch-lib/exit! 2 (supersede-lib/refusal-exit-message verdict)))))

(enforce-supersede-guard!)

;; BL-1195: pre-turn worktree-drift guard. Same posture as BL-640/BL-1084
;; above - runs BEFORE dispatch decides task vs batch, against THIS
;; worktree's own root (dispatch-lib/git-root, not project-root - a
;; master-resident role's own worktree IS the shared checkout, and every
;; other role's worktree is its own separate git root). Degrades to a
;; silent pass on any git hiccup (no git root, `git diff` failing) - it
;; only ever refuses when it can positively name real drift, same posture
;; as the reference-freshness guard above.
(defn- modified-tracked-paths [root]
  (let [result (sh/sh "git" "-C" (str root) "diff" "--name-only" "HEAD")]
    (if (zero? (:exit result))
      (remove str/blank? (str/split-lines (:out result)))
      [])))

;; "In-progress" means already RESUMED (in_process), not merely queued
;; (new/) - a role that has not yet dequeued anything has no legitimate
;; reason to have modified a tracked file at all, which is exactly
;; scenario 01's own premise; peek-candidate-task-names above deliberately
;; widens to new/ too (it is answering a different question - which task
;; name would explain a supersede match), so this guard reads in_process/
;; directly rather than reusing it.
(defn- has-in-process-parcel? []
  (boolean (seq (handoff-lib/my-handoff-files (handoff-lib/my-mailbox-dir :in_process)))))

;; BL-1195 D1 re-bounce (architect, 2026-08-28): the coder's first fix
;; (unioning every master-resident role's in_process mailbox into the
;; exemption) only widened WHICH mailbox counts as "has a parcel" - it
;; still refuses whenever NEITHER master-resident role has a dispatched
;; parcel at all, which is hardener's own reproduction verbatim (Article
;; 1.2 spec/prompt drafting has no handoff parcel to check for in the
;; first place). A wider union is the wrong shape of fix: commit_integrity_
;; lib.bb's own header names the shared `master` checkout as a genuinely
;; concurrent, multi-writer surface by DESIGN - "coordinator bookkeeping,
;; the BL-topic-record writer, QA's fast-forward, the specifier, and
;; operator_file_question.bb all commit into ONE git index with no
;; isolation" - not just the coordinator/specifier pair, and several of
;; those writers (spec/prompt drafting, backlog bookkeeping) have no
;; handoff parcel to point at even in principle. A per-role "does an
;; in_process parcel explain this diff?" check cannot distinguish a
;; legitimate concurrent writer's own WIP from real unexplained drift on
;; that surface - there is no parcel-shaped signal to widen toward.
;; Exempting master-resident worktrees from this guard entirely keeps the
;; ticket's own explicit constraint ("must not false-flag a role's own
;; legitimate in-progress edits") true by construction, at the cost of not
;; catching a BL-1195-shaped incident if it recurs specifically inside the
;; shared master checkout - the same tradeoff the ticket's own architect
;; review named as option (a) and every other guard in this codebase that
;; already special-cases master (check_branch_namespace.bb,
;; post_qa_branch_sweep_lib.bb, pre_qa_gate_gather_lib.bb) already accepts
;; for the same structural reason. Every OTHER pipeline role's own
;; dedicated `.worktrees/<role>`, exclusively written by that one role,
;; keeps this guard's full original detection value - only the
;; master-resident carve-out changes.
(defn- enforce-worktree-drift-guard! []
  (let [root (dispatch-lib/git-root)]
    (when root
      (let [role-info (handoff-lib/load-role-info (handoff-lib/current-role) root)]
        (when-not (= (:worktree-name role-info) "master")
          (let [drift (worktree-drift-lib/unexplained-drift
                       {:modified-paths (modified-tracked-paths root)
                        :has-in-progress-task? (has-in-process-parcel?)})]
            (when (worktree-drift-lib/drift-detected? drift)
              (dispatch-lib/exit! 2 (worktree-drift-lib/drift-report drift)))))))))

(enforce-worktree-drift-guard!)

;; BL-1515: pre-turn branch-identity guard. Same posture and insertion point
;; as BL-1195 above (before the inbox is read) - a role's worktree can sit
;; on a branch that is not the one roles.tsv's session column declares (the
;; coder's own worktree sat on `side` instead of `swarmforge-coder` for a
;; week; every guard that resolves a role's branch via handoff-lib/
;; load-role-info's :session degraded silently, reading a ref that no
;; longer existed). Reads the SAME accessor tree_collapse_guard_lib.bb uses
;; so the two can never drift (BL-897): (:session (handoff-lib/
;; load-role-info role root)). A role with no roles.tsv row, or a row with
;; no session, is not judged (BL-1205's own "no roles.tsv branch entry"
;; posture, unchanged). Degrades to :refuse (never a silent pass) on any
;; git read failure - unlike the drift guard above, a wrong branch identity
;; is exactly the kind of thing that must never be waved through just
;; because a git call hiccuped.
(defn- git-read [root & args]
  (let [result (apply sh/sh "git" "-C" (str root) args)]
    (when (zero? (:exit result)) (str/trim (:out result)))))

(defn- git-ref-exists? [root ref]
  (zero? (:exit (sh/sh "git" "-C" (str root) "rev-parse" "--verify" "--quiet" ref))))

(defn- git-ancestor? [root ancestor-ref descendant-ref]
  (zero? (:exit (sh/sh "git" "-C" (str root) "merge-base" "--is-ancestor" ancestor-ref descendant-ref))))

(defn- branch-identity-facts [root declared]
  (let [actual (git-read root "rev-parse" "--abbrev-ref" "HEAD")
        actual-tip (git-read root "rev-parse" "HEAD")]
    (if (or (nil? actual) (nil? actual-tip))
      {:declared declared :actual actual :actual-tip actual-tip :git-read-error? true}
      (let [declared-ref (str "refs/heads/" declared)
            declared-ref-exists? (git-ref-exists? root declared-ref)
            declared-tip (when declared-ref-exists? (git-read root "rev-parse" declared-ref))
            origin-ref (str "refs/remotes/origin/" declared)
            origin-ref-exists? (git-ref-exists? root origin-ref)]
        {:declared declared
         :actual actual
         :actual-tip actual-tip
         :declared-ref-exists? declared-ref-exists?
         :declared-tip declared-tip
         :origin-ref-exists? origin-ref-exists?
         :origin-tip-ancestor-of-actual? (boolean (and origin-ref-exists?
                                                        (git-ancestor? root origin-ref actual-tip)))
         :git-read-error? false}))))

;; Exempts master-resident roles for the same structural reason as the
;; BL-1195 drift guard above: a master-resident role (`:worktree-name
;; "master"`) shares its ONE physical checkout with every other
;; master-resident role, each declaring its own `:session` branch name
;; against that single shared, actual branch - there is no single "declared
;; branch identity" for the checkout to be judged against, and a `:repair`
;; verdict would rename the shared checkout's actual branch (e.g. `main`)
;; out from under every other master-resident role and every guard
;; elsewhere that assumes that name exists (BL-1515 hardener bounce D1,
;; 2026-09-11).
(defn- enforce-branch-identity-guard! []
  (let [root (dispatch-lib/git-root)
        role-name (handoff-lib/current-role)
        role-info (and root role-name (handoff-lib/load-role-info role-name root))
        declared (:session role-info)]
    (when (and root (not (str/blank? declared))
               (not= (:worktree-name role-info) "master"))
      (let [facts (branch-identity-facts root declared)
            verdict (branch-identity-guard-lib/decide facts)]
        (case (:status verdict)
          :ok nil
          :repair
          (let [{:keys [from to]} verdict
                rename-result (sh/sh "git" "-C" (str root) "branch" "-m" from to)]
            (if (zero? (:exit rename-result))
              (println (branch-identity-guard-lib/repaired-line
                        {:role role-name :from from :to to :at (:actual-tip facts)}))
              (dispatch-lib/exit! 2 (branch-identity-guard-lib/refusal-line
                                     (assoc facts :role role-name
                                            :reason (str "rename-failed: " (str/trim (:err rename-result))))))))
          :refuse
          (dispatch-lib/exit! 2 (branch-identity-guard-lib/refusal-line
                                 (assoc verdict :role role-name))))))))

(enforce-branch-identity-guard!)

;; BL-226: this receive helper's sole job is dispatch. Promoting paused
;; items into backlog/active/ is the coordinator's exclusive duty
;; (constitution Articles 1.1/3.3) and must respect active_backlog_max_depth
;; and Concurrent Work Orthogonality - a receive helper silently promoting
;; would bypass both. (A prior paused-item auto-promotion helper used to run
;; here after dispatch, but it was dead code besides: run-dispatch! below
;; always execs or exits, so nothing after it ever ran.)
(dispatch-lib/run-dispatch! {"batch" "ready_for_next_batch.sh" "task" "ready_for_next_task.sh"})
