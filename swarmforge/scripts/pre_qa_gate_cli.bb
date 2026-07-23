#!/usr/bin/env bb
;; BL-531: the standalone self-check any role can run before sending -
;; `pre_qa_gate.sh <task-name> <commit> [repo-root]`. Thin wrapper over
;; pre_qa_gate_gather_lib.bb's findings-for-git-handoff (the same call
;; swarm_handoff.bb makes at the live QA edge), forcing `to: QA` so the
;; gate always arms for this standalone check regardless of the parcel's
;; real eventual recipient.

(ns pre-qa-gate-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_gather_lib.bb")))

(def usage-text "Usage: pre_qa_gate.sh <task-name> <commit> [repo-root]")

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
        (let [{:keys [findings]} (pre-qa-gate-gather-lib/findings-for-git-handoff
                                   project-root {:to "QA" :task-name task-name :cited-commit canonical})]
          (if (seq findings)
            (do
              (doseq [f findings] (println (pre-qa-gate-lib/format-finding-line f)))
              (System/exit 1))
            (do (println "OK") (System/exit 0))))))))

(apply -main *command-line-args*)
