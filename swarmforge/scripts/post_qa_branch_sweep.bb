#!/usr/bin/env bb
;; BL-668: run the post-QA branch sweep against a live project root.
;; Usage: post_qa_branch_sweep.bb <project-root>

(ns post-qa-branch-sweep
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "post_qa_branch_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(def project-root (nth *command-line-args* 0))
(def daemon-dir (str (fs/path project-root ".swarmforge" "daemon")))

(defn sh! [args {:keys [dir]}]
  (process/sh {:dir (or dir project-root) :continue true} args))

(defn git-rev-parse [dir ref]
  (let [{:keys [exit out]} (sh! ["git" "rev-parse" ref] {:dir dir})]
    (when (zero? exit) (str/trim out))))

(defn role-dirty? [worktree-path]
  (let [{:keys [exit out]} (sh! ["git" "status" "--porcelain"] {:dir worktree-path})]
    (and (zero? exit) (not (str/blank? (str/trim out)))))

(defn role-in-process? [role-info]
  (let [dir (handoff-lib/mailbox-dir role-info :in_process)]
    (and (fs/directory? dir)
         (boolean
          (some #(str/ends-with? (str (fs/file-name %)) ".handoff")
                (fs/list-dir dir)))))

(defn role-facts [role-name]
  (when-let [ri (handoff-lib/load-role-info role-name project-root)]
    (let [wt (:worktree-path ri)
          head (git-rev-parse wt "HEAD")]
      {:head-sha head
       :dirty? (role-dirty? wt)
       :in-process? (role-in-process? ri)
       :can-ff? (and head
                     (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" head "origin/main"] {:dir wt})))
       :worktree-path wt
       :role-info ri})))

(defn fast-forward! [role-name facts]
  (let [wt (:worktree-path facts)
        {:keys [exit err]} (sh! ["git" "merge" "--ff-only" "--no-edit" "origin/main"] {:dir wt})]
    (if (zero? exit) {:success true} {:success false :error (str/trim (or err ""))})))

(defn -main []
  (when-not project-root
    (println "Usage: post_qa_branch_sweep.bb <project-root>") (System/exit 2))
  (sh! ["git" "fetch" "origin" "main"] {:dir project-root})
  (let [landed (git-rev-parse project-root "origin/main")
        roles (->> (handoff-lib/load-all-roles project-root)
                   (filter post-qa-branch-sweep-lib/sweep-eligible-role?)
                   (map :role))
        log-lines (atom [])
        result (post-qa-branch-sweep-lib/sweep!
                daemon-dir landed roles
                {:role-facts! role-facts
                 :fast-forward! fast-forward!
                 :log! (fn [& parts] (swap! log-lines conj (str/join " " parts))})]
    (println (str "landed=" landed " actions=" (count (:actions result))))
    (doseq [line @log-lines] (println line))
    (System/exit 0)))

(-main)
