#!/usr/bin/env bb
;; BL-1802 acceptance driver: calls master_main_reconcile_lib.bb's
;; refuse-reset-if-local-ahead! with real-git-reset-adapters directly
;; against a real checkout (a clone or a linked worktree on any branch) -
;; the SAME composition real-git-reset-adapters/refuse-reset-if-local-
;; ahead! is, never a reimplementation. Only the presence of the
;; :current-branch! adapter itself may be forced off (--no-branch-reading,
;; scenario 03's own premise: a caller not yet updated) - the branch read,
;; the ahead-count read and the reset are all real git commands.
;;
;; Usage: bb bl1802ResetOnlyMovesMainCli.bb <repo-root> [--no-branch-reading]
;; Prints one JSON line:
;;   {"success":bool,"outcome":str,"branch":str-or-null,"ahead":int-or-null,
;;    "error":str-or-null,"resetAttempted":bool}

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "master_main_reconcile_lib.bb")))

(def root (first *command-line-args*))
(def flags (set (rest *command-line-args*)))
(def no-branch-reading? (contains? flags "--no-branch-reading"))

(when-not root
  (binding [*out* *err*]
    (println "usage: bl1802ResetOnlyMovesMainCli.bb <repo-root> [--no-branch-reading]"))
  (System/exit 2))

(defn sh [& args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str root) :continue true} args)]
    {:exit exit :out (or out "") :err (or err "")}))

(def reset-attempted? (atom false))

(def full-adapters (master-main-reconcile-lib/real-git-reset-adapters {:sh! sh :reset-attempted? reset-attempted?}))

(def adapters (if no-branch-reading? (dissoc full-adapters :current-branch!) full-adapters))

(def result (master-main-reconcile-lib/refuse-reset-if-local-ahead! adapters))

(println (json/generate-string
          {:success (boolean (:success result))
           :outcome (some-> (:outcome result) name)
           :branch (:branch result)
           :ahead (:ahead result)
           :error (:error result)
           :resetAttempted @reset-attempted?}))
