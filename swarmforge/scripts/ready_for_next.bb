#!/usr/bin/env bb

(ns ready-for-next
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "dispatch_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "reference_freshness_lib.bb")))

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

(defn- main-reference-shas [root]
  (let [list-result (sh/sh "git" "-C" (str root) "ls-tree" "-r" "--name-only" "main"
                            "--" reference-freshness-lib/reference-dir-rel)]
    (if (zero? (:exit list-result))
      (into {}
            (keep (fn [path]
                    (when-not (str/blank? path)
                      (let [show-result (sh/sh "git" "-C" (str root) "show" (str "main:" path))]
                        (when (zero? (:exit show-result))
                          [path (reference-freshness-lib/sha256-hex (:out show-result))]))))
                  (str/split-lines (:out list-result))))
      {})))

(defn- enforce-reference-freshness-guard! []
  (let [root (dispatch-lib/git-root)]
    (when root
      (let [stale (reference-freshness-lib/stale-paths (worktree-reference-shas root)
                                                         (main-reference-shas root))]
        (when (seq stale)
          (dispatch-lib/exit! 2 (reference-freshness-lib/staleness-report stale)))))))

(enforce-reference-freshness-guard!)

;; BL-226: this receive helper's sole job is dispatch. Promoting paused
;; items into backlog/active/ is the coordinator's exclusive duty
;; (constitution Articles 1.1/3.3) and must respect active_backlog_max_depth
;; and Concurrent Work Orthogonality - a receive helper silently promoting
;; would bypass both. (A prior paused-item auto-promotion helper used to run
;; here after dispatch, but it was dead code besides: run-dispatch! below
;; always execs or exits, so nothing after it ever ran.)
(dispatch-lib/run-dispatch! {"batch" "ready_for_next_batch.sh" "task" "ready_for_next_task.sh"})
