#!/usr/bin/env bb
;; BL-1390: push a commit on the shared main checkout while a fast-forward is
;; still possible.
;;
;; The decision is push_sweep_lib.bb's `post-commit-decision`, and the push is
;; its `push-main!` - the same two the daemon's periodic sweep uses, so the
;; hook and the sweep can never disagree about whether a push was safe
;; (invariant 3). This file is the thin wrapper: it gathers the four facts the
;; decision needs and does what it is told.
;;
;; It NEVER exits non-zero into git: a post-commit hook cannot fail a commit,
;; but it can strand a committer with a confusing error. Every failure here is
;; a log line and exit 0.
;;
;; Usage: post_commit_push.bb <push-sweep-lib-path> <repo-dir> [<log-path>]
;;
;; <repo-dir> is the directory git RAN THE HOOK IN, never the directory the
;; hook file lives in: core.hooksPath is shared by every worktree, so the hook
;; file always sits in the master checkout and asking about its location would
;; judge a role-worktree commit as if it were a commit on main.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def ^:private args *command-line-args*)
;; BL-1198's explicit-passing intent (named in the hook, not re-derived
;; here) is unchanged for a REAL invocation, which always supplies this;
;; the fallback only fires when it is absent - a standalone analysis probe
;; (BL-1427) with empty *command-line-args*, or any future bare `bb
;; post_commit_push.bb` - so this top-level (load-file lib-path) below can
;; resolve to something real instead of nil, which the reader cannot open.
(def ^:private lib-path (or (first args) (str (fs/path (fs/parent (fs/canonicalize *file*)) "push_sweep_lib.bb"))))
(def ^:private project-root (second args))
(def ^:private log-path (nth args 2 nil))

(load-file lib-path)

;; (cmd opts), the same shape daemon_cycle_guard_lib's sh! has, so
;; push_sweep_lib.bb's push-main! takes either runner without knowing which.
;; babashka.process/sh wants the opts map FIRST and the command as varargs.
(defn- sh! [cmd opts]
  (try
    (apply process/sh (assoc opts :continue true) cmd)
    (catch Exception e
      {:exit 1 :err (str (.getMessage e))})))

(defn- log! [& parts]
  (let [line (str (java.time.Instant/now) " post-commit-push " (str/join " " parts))]
    (binding [*out* *err*] (println line))
    (when log-path
      (try
        (fs/create-dirs (fs/parent log-path))
        (spit log-path (str line "\n") :append true)
        (catch Exception _ nil)))))

(defn- git [& cmd]
  (sh! (into ["git"] cmd) {:dir project-root}))

(defn- current-branch []
  (let [{:keys [exit out]} (git "rev-parse" "--abbrev-ref" "HEAD")]
    (when (zero? exit) (str/trim out))))

;; A LINKED worktree's `.git` is a FILE, not a directory - a test on
;; `.git/` shape is the reliable read, and `--git-common-dir` differing from
;; `--git-dir` is git's own answer to the same question.
(defn- linked-worktree? []
  (let [{:keys [exit out]} (git "rev-parse" "--git-dir" "--git-common-dir")]
    (if (zero? exit)
      (let [[git-dir common] (str/split-lines (str/trim (str out)))]
        ;; git's own answer, with no path arithmetic: in a linked worktree the
        ;; two differ (.git/worktrees/<name> vs .git), and in the master
        ;; checkout they are the same string.
        (not= (str/trim (str git-dir)) (str/trim (str (or common git-dir)))))
      ;; Could not ask: treat as linked, which pushes nothing. Failing closed
      ;; costs one deferred push the periodic sweep still makes.
      true)))

(defn- rev-counts []
  (let [{:keys [exit out]} (git "rev-list" "--left-right" "--count" "origin/main...main")]
    (when (zero? exit)
      (let [[behind ahead] (map parse-long (str/split (str/trim (str out)) #"\s+"))]
        {:ahead (or ahead 0) :behind (or behind 0)}))))

(defn -main []
  (let [branch (current-branch)
        linked? (linked-worktree?)
        ;; The cheap refusal FIRST: a role-branch commit costs no fetch at all
        ;; (scenario 03 asserts nothing is fetched, and a fetch on every
        ;; worktree commit would be the stall this hook must not become).
        pre (push-sweep-lib/post-commit-decision
             {:branch branch :linked-worktree? linked? :ahead 0 :behind 0})]
    (when-not (= pre :not-shared-checkout)
      ;; The fetch is bounded by the CALLER (the hook's `timeout`), so an
      ;; unreachable origin costs the bound and not the committer's session.
      ;; The refspec is EXPLICIT. `git fetch origin main` updates FETCH_HEAD and
      ;; only opportunistically the remote-tracking ref - and the counts below
      ;; are read from `origin/main`, so a fetch that left that ref stale
      ;; reported "ahead, not behind" while origin had already moved, and the
      ;; hook pushed over somebody else's tip. Caught by this ticket's own e2e
      ;; scenario 02 before it ever ran anywhere real.
      (let [fetched (git "fetch" "--quiet" "origin" "+refs/heads/main:refs/remotes/origin/main")
            ;; A failed fetch is NOT a fresh read. Its stale counts say "ahead,
            ;; not behind" in precisely the case where origin has moved and we
            ;; could not see it - which would push over somebody else's tip,
            ;; the very thing invariant 1 forbids. Fail closed: the periodic
            ;; sweep still pushes once the network is back.
            counts (when (zero? (:exit fetched)) (rev-counts))
            decision (push-sweep-lib/post-commit-decision
                      (merge {:branch branch :linked-worktree? linked?} counts))]
        (when-not (zero? (:exit fetched))
          (log! "fetch-failed" "push not attempted -" (str/trim (str (or (:err fetched) "")))))
        (case decision
          :should-push
          (let [{:keys [success error]} (push-sweep-lib/push-main! project-root sh!)]
            (if success
              (log! "pushed" branch)
              ;; Never a retry-with-force here: a refused non-fast-forward push
              ;; means origin moved under us, and the periodic sweep is the
              ;; fallback that owns retrying.
              (log! "push-failed" (or error ""))))
          :diverged (log! "diverged" "leaving the join to the reconcile sweep")
          :counts-unknown (log! "counts-unknown" "push not attempted")
          (log! (name decision)))))))

(-main)
;; Always 0: a post-commit hook must never look like a failure to git.
(System/exit 0)
