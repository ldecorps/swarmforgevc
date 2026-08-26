#!/usr/bin/env bb
;; BL-924: the merge path fix. sync_worktree_scripts() leaves untracked
;; copies of git-tracked scripts behind in every role worktree (BL-373's
;; own mechanism); git refuses ANY merge that would overwrite an untracked
;; file, even one byte-identical to the incoming tracked content. This
;; script is what a worktree's own "bring current with <ref>" step runs
;; instead of a bare `git merge <ref>`: it discovers every untracked path
;; the merge would collide with, proves each one's content against the
;; ref's own tracked blob, clears ONLY when every candidate is byte-
;; identical (untracked_collision_clear_lib.bb's own all-or-nothing rule),
;; then runs the real merge. A single genuine difference refuses the whole
;; operation up front - nothing is removed, nothing is merged - and names
;; every colliding path in the one report, never an iterative discovery
;; loop (the "... 10 more" elision the 2026-07-25 incident hit).
;;
;; Usage: clear_identical_untracked_and_merge.bb <worktree-root> <ref>
;; Exit 0 with the merge's own result on success; exit 1 with the blocking
;; paths listed and NOTHING touched when a genuine collision exists.

(require '[babashka.fs :as fs]
         '[clojure.java.shell :as sh]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "untracked_collision_clear_lib.bb")))

(defn- run [& args]
  (apply sh/sh args))

(defn- lines [s]
  (remove str/blank? (str/split-lines (or s ""))))

(defn- untracked-paths [root]
  (let [result (run "git" "-C" root "ls-files" "--others" "--exclude-standard")]
    (set (lines (:out result)))))

(defn- tracked-paths-at-ref [root ref]
  (let [result (run "git" "-C" root "ls-tree" "-r" "--name-only" ref)]
    (set (lines (:out result)))))

;; A candidate is untracked in THIS worktree AND tracked at the incoming
;; ref - exactly the set `git merge` would refuse to overwrite. Anything
;; untracked that the ref does NOT track is never a candidate at all -
;; invariant 2 by construction, not a filter applied after the fact.
(defn- candidate-paths [root ref]
  (clojure.set/intersection (untracked-paths root) (tracked-paths-at-ref root ref)))

(defn- ref-content [root ref path]
  (let [result (run "git" "-C" root "show" (str ref ":" path))]
    (when (zero? (:exit result))
      (:out result))))

;; Byte comparison reads the untracked file directly off disk (never
;; through git, which has no index entry for it) against the ref's own
;; tracked blob - the per-file identity proof invariant 2 requires.
(defn- identical-to-ref? [root ref path]
  (let [on-disk (try (slurp (str (fs/path root path))) (catch Exception _ nil))
        incoming (ref-content root ref path)]
    (and (some? on-disk) (some? incoming) (= on-disk incoming))))

(defn- collisions [root ref]
  (mapv (fn [path] {:path path :identical? (identical-to-ref? root ref path)})
        (sort (candidate-paths root ref))))

(defn -main [root ref]
  (let [found (collisions root ref)
        plan (untracked-collision-clear-lib/plan-untracked-collision-clear found)]
    (if (:ok? plan)
      (do
        (doseq [path (:clear-paths plan)]
          (fs/delete (fs/path root path))
          (println (str "clear_identical_untracked_and_merge.bb: cleared (byte-identical to " ref "): " path)))
        (let [merge-result (run "git" "-C" root "merge" ref "--no-edit")]
          (print (:out merge-result))
          (binding [*out* *err*] (print (:err merge-result)))
          (System/exit (:exit merge-result))))
      (do
        (binding [*out* *err*]
          (println "clear_identical_untracked_and_merge.bb: REFUSED - the following untracked path(s) differ from"
                    ref "and would lose content if overwritten; nothing was cleared, nothing was merged:")
          (doseq [path (:blocking-paths plan)]
            (println (str "  " path))))
        (System/exit 1)))))

(apply -main *command-line-args*)
