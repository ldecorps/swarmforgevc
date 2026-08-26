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

(require '[babashka.fs :as fs]
         '[clojure.java.shell :as sh]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "sync_worktree_scripts_lib.bb")))

(defn- tracked-paths [worktree-root rel-prefix]
  (let [result (sh/sh "git" "-C" worktree-root "ls-files" "--" rel-prefix)]
    (if (zero? (:exit result))
      (set (remove str/blank? (str/split-lines (:out result))))
      #{})))

(defn- relative-source-files [source-dir]
  (let [root (fs/path source-dir)]
    (->> (file-seq (fs/file source-dir))
         (filter fs/regular-file?)
         (map (fn [f] (str (fs/relativize root (fs/path f))))))))

(defn -main [source-dir dest-dir worktree-root rel-prefix]
  (let [tracked (tracked-paths worktree-root rel-prefix)]
    (doseq [rel (relative-source-files source-dir)]
      (let [dest-relative-path (str rel-prefix "/" rel)]
        (if (sync-worktree-scripts-lib/should-copy?
             {:tracked-paths tracked :dest-relative-path dest-relative-path})
          (let [dest-path (fs/path dest-dir rel)]
            (fs/create-dirs (fs/parent dest-path))
            (fs/copy (fs/path source-dir rel) dest-path {:replace-existing true}))
          (println (str "sync_worktree_scripts.bb: left to git (tracked): " dest-relative-path)))))))

(apply -main *command-line-args*)
