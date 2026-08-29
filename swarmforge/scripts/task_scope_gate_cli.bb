#!/usr/bin/env bb
;; BL-1257: the REVIEW-TIME entry point for task_scope_gate_lib.bb (BL-1192)
;; - the same authored-scope basis the send-time gate (swarm_handoff.bb's own
;; call) already uses, given a second caller so QA's own review-time
;; entangled-tip check answers the identical question the same way instead
;; of hand-rolling `git diff --name-only origin/main <commit>` (which
;; explodes into false positives the moment local main outruns origin/main -
;; the 2026-08-29 BL-1247/BL-1238 incident this ticket exists to close).
;;
;; Never a second implementation of the scope walk itself (invariant 2 -
;; "the send-time gate and the review-time check never return opposite
;; verdicts for the same commit and task") - this file is IO/argv only,
;; calling task-scope-gate-lib/findings-for-git-handoff exactly as
;; swarm_handoff.bb does.
;;
;; Usage: task_scope_gate_cli.bb <task-name> <commit> [repo-root]
;;   Exit 0 and "OK" when no foreign scope is found (or the walk could not
;;   be read at all - fail-open, per the underlying lib's own posture,
;;   printed as a WARNING, never silently swallowed).
;;   Exit 1 and the same refusal-message text swarm_handoff.bb's own
;;   refusal uses - naming every foreign path and its owning ticket, never
;;   a bare count of paths differing from origin/main - when foreign scope
;;   is found.

(ns task-scope-gate-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_scope_gate_lib.bb")))

(def usage-text "Usage: task_scope_gate_cli.bb <task-name> <commit> [repo-root]")

(defn- resolve-repo-root [explicit]
  (or explicit
      (let [res (process/sh ["git" "rev-parse" "--show-toplevel"])]
        (when (zero? (:exit res)) (str/trim (:out res))))))

(defn- canonicalize-commit [project-root commit]
  (let [res (process/sh ["git" "-C" (str project-root) "rev-parse" "--short=10" commit])]
    (when (zero? (:exit res)) (str/trim (:out res)))))

(defn -main [& args]
  (let [[task-name commit repo-root-arg] args]
    (when (or (str/blank? task-name) (str/blank? commit))
      (binding [*out* *err*] (println usage-text))
      (System/exit 2))
    (let [project-root (resolve-repo-root repo-root-arg)]
      (when-not project-root
        (binding [*out* *err*] (println "Cannot resolve repo root; pass it explicitly."))
        (System/exit 2))
      (let [canonical (canonicalize-commit project-root commit)]
        (when-not canonical
          (binding [*out* *err*] (println (str "Cannot resolve commit: " commit)))
          (System/exit 2))
        (let [result (task-scope-gate-lib/findings-for-git-handoff
                       {:root project-root :task-name task-name :commit canonical})]
          (if-let [warning (:warning result)]
            (do
              (binding [*out* *err*] (println (str "TASK_SCOPE_GATE WARNING: " warning)))
              (println "OK")
              (System/exit 0))
            (if (task-scope-gate-lib/blocked? result)
              (do
                (println (task-scope-gate-lib/refusal-message {:task-name task-name :findings (:findings result)}))
                (System/exit 1))
              (do (println "OK") (System/exit 0)))))))))

(apply -main *command-line-args*)
