;; BL-1652: the chase sweep's second respawn guard - "is a test/mutation/
;; acceptance lane running under this role's own worktree right now, so a
;; respawn must wait." Split out of handoffd.bb (not defined inline there)
;; because bl1163HandoffdParse.property.test.js's own balance check is a
;; raw open/close-paren SCAN over handoffd.bb's literal text, with no
;; awareness of Clojure string/regex escaping - a `\(` inside THIS file's
;; own pattern literal (a literal "(" to match against a real cmdline like
;; "(vitest...)") reads as an unmatched open paren to that scanner even
;; though bb itself parses the file correctly (proven: `bb -e (load-file
;; ...)` succeeds). worktree_stray_lib.bb's own job-process-pattern carries
;; the identical `\(vitest` motif already - it simply lives in a file that
;; scanner never reads. Never inline this pattern into handoffd.bb again.
;;
;; Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "lane_process_lib.bb")))
;; and referred to as lane-process-lib/foo.
(ns lane-process-lib
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "process_table_lib.bb")))

;; Vitest, Stryker/gherkin mutation, a bb test runner
;; (swarmforge/scripts/test/*_test_runner.bb), or the acceptance-pipeline
;; CLI (run_acceptance.sh) - deliberately its OWN pattern, not
;; worktree_stray_lib.bb's job-process-pattern (mirrored 1:1 with
;; handoffd_supervisor.bb's own copy under a BL-897 agreement test) - this
;; answers a different question (is a lane running right now, so a respawn
;; must wait) from theirs (is this an orphan to reap), so conflating the
;; two literals would make an unrelated ticket's orphan-pattern edit
;; silently change what a respawn waits on.
(def lane-process-pattern
  #"(?i)stryker|vitest\.properties\.config\.mjs|\bnpm exec vitest\b|\bnpx vitest\b|\(vitest|_test_runner\.bb|run_acceptance\.sh")

(defn lane-running?
  "True when a lane-process-pattern process is running scoped to worktree
   (cmdline names the path, or its cwd is under it) - read once per role
   per sweep (one process-table scan), never per item."
  [worktree]
  (boolean
   (when worktree
     (when-let [processes (process-table-lib/list-processes!)]
       (some (fn [{:keys [pid cmdline]}]
               (and (re-find lane-process-pattern (or cmdline ""))
                    (process-table-lib/project-scoped-process?
                     cmdline (process-table-lib/cwd! pid) [(str worktree)])))
             processes)))))
