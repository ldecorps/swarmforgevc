;; BL-106: derives and validates the unified <swarm_name>/<role> worktree
;; branch namespace (git-idiomatic slash namespace: groups and sorts per
;; swarm, and lets two swarms share one repo's worktrees with zero branch-
;; ref collisions). Pure; swarmforge.sh, any validation gate, and the
;; migration script (migrate_branch_names.sh) wire this to real git.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "branch_naming_lib.bb")))
;; and referred to as branch-naming-lib/foo.
(ns branch-naming-lib)

(defn derive-branch-name
  "The unified branch name for a role worktree under a given swarm."
  [swarm-name role]
  (str swarm-name "/" role))

(defn validate-branch
  "Checks whether actual-branch matches the expected <swarm-name>/<role>
   namespace. Returns {:ok true} when it matches, or {:ok false :expected
   <name>} so a caller can fail fast naming the expected branch (BL-106
   branch-ns-03)."
  [actual-branch swarm-name role]
  (let [expected (derive-branch-name swarm-name role)]
    (if (= actual-branch expected)
      {:ok true}
      {:ok false :expected expected})))
