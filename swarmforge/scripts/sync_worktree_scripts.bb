#!/usr/bin/env bb
;; BL-373: thin CLI wrapper so swarmforge.sh (zsh) can call the pure
;; should-copy? decision. Copies every regular file under SOURCE-DIR into
;; DEST-DIR, except a file whose repo-relative path (REL-PREFIX/<path
;; under SOURCE-DIR>) is tracked by WORKTREE-ROOT's own git index - that
;; path is left to git, which already delivers it (the role's branch has
;; it). Prints one "left to git" line per skipped path so a launch that
;; declines to overwrite SAYS so, never silently (BL-373 scenario 05).
;;
;; Usage: sync_worktree_scripts.bb <source-dir> <dest-dir> <worktree-root> <rel-prefix>
;;
;; BL-1233: an ambient GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE in this
;; process's own environment makes `git -C worktree-root ...` answer for
;; whatever repo those variables point at instead of worktree-root - `-C`
;; does not override them. Every git call below runs with them scrubbed,
;; AND the tracked-path answer is trusted only after independently
;; confirming git resolved worktree-root's own top-level, never on faith
;; that the scrub alone was enough (defense in depth against the next
;; vector). A destination whose own git legitimately tracks nothing under
;; rel-prefix (BL-373 scenario 03) still resolves its OWN top-level
;; correctly and is unaffected by this check.

(require '[babashka.fs :as fs]
         '[clojure.java.shell :as sh]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "sync_worktree_scripts_lib.bb")))

(defn- scrubbed-git-env []
  (dissoc (into {} (System/getenv)) "GIT_DIR" "GIT_WORK_TREE" "GIT_INDEX_FILE"))

(defn- git-sh [worktree-root & args]
  (apply sh/sh "git" "-C" worktree-root (concat args [:env (scrubbed-git-env)])))

(defn- resolve-worktree-toplevel
  "nil when git could not resolve worktree-root at all (non-zero exit)."
  [worktree-root]
  (let [result (git-sh worktree-root "rev-parse" "--show-toplevel")]
    (when (zero? (:exit result))
      (str/trim (:out result)))))

(defn- tracked-paths [worktree-root rel-prefix]
  (let [result (git-sh worktree-root "ls-files" "--" rel-prefix)]
    (if (zero? (:exit result))
      (set (remove str/blank? (str/split-lines (:out result))))
      #{})))

(defn- relative-source-files [source-dir]
  (let [root (fs/path source-dir)]
    (->> (file-seq (fs/file source-dir))
         (filter fs/regular-file?)
         (map (fn [f] (str (fs/relativize root (fs/path f))))))))

(defn -main [source-dir dest-dir worktree-root rel-prefix]
  (let [resolved-toplevel (resolve-worktree-toplevel worktree-root)
        worktree-root-real (str (fs/canonicalize worktree-root))
        resolved-toplevel-real (when resolved-toplevel (str (fs/canonicalize resolved-toplevel)))]
    (if-not (sync-worktree-scripts-lib/trustworthy-tracked-answer?
             {:worktree-root-real worktree-root-real
              :resolved-toplevel-real resolved-toplevel-real})
      (do
        (binding [*out* *err*]
          (println
           (str "sync_worktree_scripts.bb: REFUSE - asked git about worktree-root "
                worktree-root " but it resolved to "
                (or resolved-toplevel "no top-level at all (non-zero exit)")
                " instead (ambient GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE?)."
                " Copying nothing rather than trust an untrustworthy tracked-path answer.")))
        (System/exit 1))
      (let [tracked (tracked-paths worktree-root rel-prefix)]
        (doseq [rel (relative-source-files source-dir)]
          (let [dest-relative-path (str rel-prefix "/" rel)]
            (if (sync-worktree-scripts-lib/should-copy?
                 {:tracked-paths tracked :dest-relative-path dest-relative-path})
              (let [dest-path (fs/path dest-dir rel)]
                (fs/create-dirs (fs/parent dest-path))
                (fs/copy (fs/path source-dir rel) dest-path {:replace-existing true}))
              (println (str "sync_worktree_scripts.bb: left to git (tracked): " dest-relative-path)))))))))

(apply -main *command-line-args*)
