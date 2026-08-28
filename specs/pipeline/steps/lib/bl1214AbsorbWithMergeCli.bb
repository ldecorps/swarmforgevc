#!/usr/bin/env bb
;; BL-1214 acceptance driver: calls master_main_reconcile_lib.bb's real
;; absorb-with-merge! against a REAL git repo, with REAL :ff!/:merge!/
;; :abort!/:fallback! adapters - the exact same adapter shape handoffd.bb
;; wires for its :ff-absorb execution branch (`git merge --ff-only`, then a
;; real `git merge --no-edit`, then `git merge --abort` + rematch fallback).
;; Bypasses the higher-level absorb-dispatch-plan/sweep! decision layer
;; deliberately, same precedent as bl1198RematchPushFirstCli.bb: this
;; ticket changes how an already-planned :ff-absorb is EXECUTED, not when
;; it is planned (out_of_scope), so driving absorb-with-merge! directly is
;; what exercises exactly the in-scope behavior.
;;
;; Usage: bb bl1214AbsorbWithMergeCli.bb <repo-root>
;; Exits 0 always; prints one JSON line
;; {"outcome":str,"ffAttempted":bool,"mergeAttempted":bool,
;;  "abortAttempted":bool,"fallbackAttempted":bool} to stdout.
(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "master_main_reconcile_lib.bb")))

(def root (first *command-line-args*))
(when-not root
  (binding [*out* *err*] (println "usage: bl1214AbsorbWithMergeCli.bb <repo-root>"))
  (System/exit 2))

(defn sh [& args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str root) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(sh "git" "fetch" "origin" "main")

(def ff-attempted? (atom false))
(def merge-attempted? (atom false))
(def abort-attempted? (atom false))
(def fallback-attempted? (atom false))

;; BL-1120: a foreign MERGE_HEAD is owned by whoever started it - never
;; touched here. Production never even reaches absorb-with-merge! in that
;; case (automated-absorb-plan's :skip-human-merge-in-progress short-
;; circuits one layer up, in absorb-dispatch-plan); mirrored here so this
;; driver matches production exactly rather than re-deriving the guard.
(def merge-head-present?
  (zero? (:exit (sh "git" "rev-parse" "-q" "--verify" "MERGE_HEAD"))))

(def result
  (if merge-head-present?
    {:success false :outcome :human-merge-in-progress}
    (master-main-reconcile-lib/absorb-with-merge!
     {:ff! (fn []
             (reset! ff-attempted? true)
             (let [r (sh "git" "merge" "--ff-only" "--no-edit" "origin/main")]
               {:success (zero? (:exit r))}))
      :merge! (fn []
                (reset! merge-attempted? true)
                (let [r (sh "git" "merge" "--no-edit" "origin/main")]
                  {:success (zero? (:exit r)) :error (:err r)}))
      :abort! (fn []
                (reset! abort-attempted? true)
                (sh "git" "merge" "--abort"))
      :fallback! (fn []
                   (reset! fallback-attempted? true)
                   (let [r (sh "git" "reset" "--hard" "origin/main")]
                     {:success (zero? (:exit r)) :outcome :rematched-refuse}))})))

(println (json/generate-string {:outcome (name (:outcome result))
                                 :ffAttempted @ff-attempted?
                                 :mergeAttempted @merge-attempted?
                                 :abortAttempted @abort-attempted?
                                 :fallbackAttempted @fallback-attempted?}))
(System/exit 0)
