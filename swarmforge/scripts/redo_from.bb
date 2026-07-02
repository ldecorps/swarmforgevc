#!/usr/bin/env bb

;; redo_from — salvage a failed or rejected pipeline run by restarting a work
;; item from a named stage (BL-036).
;;
;;   redo_from.sh <item-id> <stage> [reason...]
;;
;; Steps, in order:
;;   1. validate the stage (nothing is touched on an invalid stage)
;;   2. abandon the item's stale handoffs (inbox new/ and in_process/ across
;;      all worktrees move to inbox/abandoned/ so no role processes them)
;;   3. tag the current HEAD as redo/<item-id>/<stage>/<timestamp>
;;   4. queue a fresh git_handoff to the stage's role, using the last known
;;      good commit previously handed to that stage (current HEAD for coder
;;      or when no prior handoff exists)
;;   5. append an {event: redo} entry to .swarmforge/run-log.jsonl, capturing
;;      the rejection_reason from the item's most recent rejection handoff
;;      when no explicit reason is given

(ns redo-from
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def stage->role
  {"coder" "coder"
   "cleaner" "cleaner"
   "architect" "architect"
   "hardender" "hardender"
   "documenter" "documenter"
   "qa" "QA"})

(def stage-order ["coder" "cleaner" "architect" "hardender" "documenter" "qa"])

(defn exit! [status message]
  (binding [*out* *err*]
    (println message))
  (System/exit status))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))

(defn sh-out [dir & args]
  (let [result (apply process/sh {:dir dir} args)]
    (when (zero? (:exit result))
      (str/trim (:out result)))))

(defn project-root []
  (let [root (sh-out "." "git" "rev-parse" "--show-toplevel")]
    (cond
      (nil? root) (exit! 1 "Not inside a git repository.")
      (fs/exists? (fs/path root ".swarmforge" "roles.tsv")) root
      :else
      (let [common (sh-out "." "git" "rev-parse" "--git-common-dir")
            candidate (some-> common fs/absolutize fs/parent str)]
        (if (and candidate (fs/exists? (fs/path candidate ".swarmforge" "roles.tsv")))
          candidate
          (exit! 1 "Cannot find SwarmForge project root"))))))

(defn worktree-paths [root]
  (->> (str/split-lines (slurp (str (fs/path root ".swarmforge" "roles.tsv"))))
       (remove str/blank?)
       (map #(get (str/split % #"\t") 2))
       (remove nil?)
       distinct))

(defn header-field [file field]
  (let [prefix (str field ": ")]
    (some (fn [line]
            (when (str/starts-with? line prefix)
              (subs line (count prefix))))
          (take-while (complement str/blank?)
                      (str/split-lines (slurp (str file)))))))

(defn item-handoff? [file item-id]
  (some-> (header-field file "task")
          str/lower-case
          (str/starts-with? (str/lower-case item-id))))

(defn handoff-files [dir]
  (when (fs/exists? dir)
    (filter #(and (fs/regular-file? %)
                  (str/ends-with? (fs/file-name %) ".handoff"))
            (fs/list-dir dir))))

(defn abandon-stale! [root item-id]
  (vec
   (for [wt (worktree-paths root)
         state ["new" "in_process"]
         :let [inbox (fs/path wt ".swarmforge" "handoffs" "inbox")]
         file (handoff-files (fs/path inbox state))
         :when (item-handoff? file item-id)]
     (let [abandoned-dir (fs/path inbox "abandoned")
           target (fs/path abandoned-dir (fs/file-name file))]
       (fs/create-dirs abandoned-dir)
       (fs/move file target {:replace-existing false})
       target))))

(defn latest-item-handoffs
  "The item's handoffs across every worktree's completed/ and abandoned/
   dirs, newest first (filenames embed timestamp+sequence)."
  [root item-id]
  (->> (worktree-paths root)
       (mapcat (fn [wt]
                 (let [inbox (fs/path wt ".swarmforge" "handoffs" "inbox")]
                   (concat (handoff-files (fs/path inbox "completed"))
                           (handoff-files (fs/path inbox "abandoned"))))))
       (filter #(item-handoff? % item-id))
       (sort-by #(fs/file-name %))
       reverse))

(defn last-good-commit [root item-id stage]
  (let [role (stage->role stage)]
    (or (when-not (= "coder" stage)
          (some (fn [file]
                  (when (= role (or (header-field file "recipient")
                                    (header-field file "to")))
                    (header-field file "commit")))
                (latest-item-handoffs root item-id)))
        (sh-out root "git" "rev-parse" "--short=10" "HEAD"))))

(defn captured-rejection-reason [root item-id]
  (some #(header-field % "rejection_reason")
        (latest-item-handoffs root item-id)))

(defn task-name [root item-id]
  (or (some #(header-field % "task") (latest-item-handoffs root item-id))
      item-id))

(defn tag-checkpoint! [root item-id stage]
  ;; Millisecond resolution plus a bounded uniquifier: rapid successive redos
  ;; of the same item+stage must each get their own checkpoint tag (QA defect:
  ;; same-second redos collided and the second redo aborted).
  (let [stamp (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss.SSS'Z'")
                       (.atZone (java.time.Instant/now) java.time.ZoneOffset/UTC))
        base (str "redo/" item-id "/" stage "/" stamp)]
    (loop [attempt 0]
      (let [tag (if (zero? attempt) base (str base "-" (inc attempt)))
            result (process/sh {:dir root} "git" "tag" tag)]
        (cond
          (zero? (:exit result)) tag

          (and (< attempt 10)
               (str/includes? (str (:err result)) "already exists"))
          (recur (inc attempt))

          :else
          (exit! 1 (str "Failed to create checkpoint tag " tag ": " (:err result))))))))

(defn queue-handoff! [root role task commit]
  (let [tmp-dir (fs/path root "tmp")
        draft (fs/path tmp-dir "redo-handoff-draft.txt")]
    (fs/create-dirs tmp-dir)
    (spit (str draft)
          (str "type: git_handoff\n"
               "to: " role "\n"
               "priority: 00\n"
               "task: " task "\n"
               "commit: " commit "\n"))
    (let [result (process/sh {:dir root
                              :extra-env {"SWARMFORGE_ROLE"
                                          (or (not-empty (System/getenv "SWARMFORGE_ROLE"))
                                              "coordinator")}}
                             (str (fs/path script-dir "swarm_handoff.sh"))
                             (str draft))]
      (when-not (zero? (:exit result))
        (exit! 1 (str "Failed to queue redo handoff:\n" (:err result))))
      (str/trim (:out result)))))

(defn log-redo! [root entry]
  (spit (str (fs/path root ".swarmforge" "run-log.jsonl"))
        (str (json/generate-string entry) "\n")
        :append true))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT)
           (java.time.Instant/now)))

(defn -main [& args]
  (let [[item-id stage & reason-words] args]
    (when (or (str/blank? item-id) (str/blank? stage))
      (exit! 1 "Usage: redo_from.sh <item-id> <stage> [reason...]"))
    (when-not (contains? stage->role stage)
      (exit! 2 (str "Invalid stage '" stage "'. Valid stages: "
                    (str/join " | " stage-order))))
    (let [root (project-root)
          abandoned (abandon-stale! root item-id)
          reason (or (not-empty (str/join " " reason-words))
                     (captured-rejection-reason root item-id)
                     "manual redo")
          commit (last-good-commit root item-id stage)
          tag (tag-checkpoint! root item-id stage)
          queued (queue-handoff! root (stage->role stage) (task-name root item-id) commit)]
      (log-redo! root {:event "redo"
                       :item item-id
                       :from_stage stage
                       :reason reason
                       :tag tag
                       :commit commit
                       :abandoned (count abandoned)
                       :at (now-iso)})
      (println (str "REDO: " item-id " from " stage
                    " (commit " commit ", " (count abandoned) " stale handoff(s) abandoned)"))
      (println (str "CHECKPOINT: " tag))
      (println queued))))

(apply -main *command-line-args*)
