;; BL-1515: pre-turn guard - a role's worktree can sit on a branch that is
;; not the one roles.tsv names (the coder's own worktree sat on `side`
;; instead of `swarmforge-coder` from 2026-09-03 12:46:29 onward, its local
;; `swarmforge-coder` ref gone entirely). Every guard that resolves a role's
;; branch from roles.tsv's session column (tree_collapse_guard_lib.bb's
;; recipient-branch-ref, the land walk's `git log main..swarmforge-coder`
;; recipe) degraded to "send allowed, unverified" or an empty range against
;; a ref that did not exist for a week - the guard read green while checking
;; nothing.
;;
;; Pure decision logic only - ready_for_next.bb wires this to real git (the
;; same split BL-1195's worktree_drift_lib.bb uses): every git read (the
;; checked-out branch, both tips, whether each ref exists, whether origin's
;; tip is an ancestor of the checked-out tip) happens in the caller; this
;; namespace only decides, from already-gathered facts, one of :ok / :repair
;; / :refuse, and formats the two printed lines. Loaded via load-file, not
;; required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "branch_identity_guard_lib.bb")))
;; and referred to as branch-identity-guard-lib/foo.

(ns branch-identity-guard-lib)

;; Declared invariant 1 (BL-654: coder-authored first): a ref is changed
;; ONLY in the one provably safe shape - the declared local branch is
;; absent, AND either origin/<declared> does not exist or its tip is
;; contained in the checked-out branch's tip - and then only by renaming
;; the checked-out branch onto the declared name. Every other shape
;; (declared ref present at any tip, a detached HEAD, a git-read failure,
;; or a declared ref absent whose origin tip is NOT contained) is :refuse
;; and changes nothing. `decide` never has a fourth outcome.
(defn decide
  "facts: {:declared string, :actual string (\"HEAD\" means detached),
   :declared-ref-exists? bool, :declared-tip string-or-nil,
   :actual-tip string-or-nil, :origin-ref-exists? bool,
   :origin-tip-ancestor-of-actual? bool, :git-read-error? bool}.

   Returns one of:
     {:status :ok}
     {:status :repair :from actual :to declared}
     {:status :refuse :reason string :declared declared :actual actual
      :declared-tip declared-tip :actual-tip actual-tip}"
  [{:keys [declared actual declared-ref-exists? declared-tip actual-tip
           origin-ref-exists? origin-tip-ancestor-of-actual? git-read-error?]}]
  (cond
    git-read-error?
    {:status :refuse :reason "git-read-error"
     :declared declared :actual actual :declared-tip declared-tip :actual-tip actual-tip}

    (= actual "HEAD")
    {:status :refuse :reason "detached-head"
     :declared declared :actual actual :declared-tip declared-tip :actual-tip actual-tip}

    (= actual declared)
    {:status :ok}

    declared-ref-exists?
    {:status :refuse :reason "declared-ref-exists-at-a-different-tip"
     :declared declared :actual actual :declared-tip declared-tip :actual-tip actual-tip}

    (or (not origin-ref-exists?) origin-tip-ancestor-of-actual?)
    {:status :repair :from actual :to declared}

    :else
    {:status :refuse :reason "origin-tip-is-not-an-ancestor-of-the-checked-out-branch"
     :declared declared :actual actual :declared-tip declared-tip :actual-tip actual-tip}))

(defn repaired-line
  "The one line printed on a :repair - `at` is the commit the rename left
   HEAD at (unchanged by the rename itself, since renaming a branch never
   moves its tip)."
  [{:keys [role from to at]}]
  (str "BRANCH_DRIFT_REPAIRED role=" role " from=" from " to=" to " at=" at))

(defn refusal-line
  "The one line printed on a :refuse, naming both tips (absent when the
   declared ref does not exist) - invariant 2's contract for what a refused
   turn must print."
  [{:keys [role declared actual declared-tip actual-tip reason]}]
  (str "BRANCH_DRIFT_DETECTED role=" role
       " declared=" declared
       " actual=" actual
       " declared_tip=" (or declared-tip "absent")
       " actual_tip=" (or actual-tip "absent")
       " reason=" reason))
