;; Shared plumbing for redo_from.bb (BL-036) and reroute.bb/reroute_resume.bb
;; (BL-063): abandon an item's stale in-flight handoffs across every
;; worktree, tag a checkpoint, and re-inject a fresh git_handoff at a named
;; stage. Loaded via load-file, not required on a classpath, so callers do:
;;   (load-file (str (fs/path (fs/parent *file*) "salvage_lib.bb")))
;; and refer to symbols as salvage-lib/foo.
;;
;; BL-063 extracted this from redo_from.bb so the reroute machinery reuses
;; the exact same abandonment/re-injection mechanism instead of building a
;; second parallel one — the ticket's own explicit instruction.

(ns salvage-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

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
   (for [role-info (handoff-lib/load-all-roles root)
         state [:new :in_process]
         file (handoff-files (handoff-lib/mailbox-dir role-info state))
         :when (item-handoff? file item-id)]
     (let [abandoned-dir (handoff-lib/mailbox-dir role-info :abandoned)
           target (fs/path abandoned-dir (fs/file-name file))]
       (fs/create-dirs abandoned-dir)
       (fs/move file target {:replace-existing false})
       target))))

(defn latest-item-handoffs
  "The item's handoffs across every ROLE's own completed/ and abandoned/
   mailbox dirs, newest first (filenames embed timestamp+sequence).
   Iterating per role (not deduped worktree path) is what visits
   master-resident roles' now-distinct per-role subdirectories instead of
   scanning their one shared worktree path just once (BL-128)."
  [root item-id]
  (->> (handoff-lib/load-all-roles root)
       (mapcat (fn [role-info]
                 (concat (handoff-files (handoff-lib/mailbox-dir role-info :completed))
                         (handoff-files (handoff-lib/mailbox-dir role-info :abandoned)))))
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
  ;; Millisecond resolution plus a bounded uniquifier: rapid successive
  ;; salvage operations on the same item+stage must each get their own
  ;; checkpoint tag (QA defect: same-second redos collided and the second
  ;; one aborted).
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

(defn queue-handoff!
  "Queues a fresh git_handoff at role for task/commit via swarm_handoff.sh.
   extra-headers is an optional map of additional draft header lines (e.g.
   {\"rejection_reason\" \"...\"} for redo, {\"reroute_reason\" \"...\"} for
   reroute — both validated fields swarm_handoff.bb already allows)."
  ([root role task commit] (queue-handoff! root role task commit nil))
  ([root role task commit extra-headers]
   (let [tmp-dir (fs/path root "tmp")
         draft (fs/path tmp-dir "salvage-handoff-draft.txt")
         extra-lines (str/join "" (for [[k v] extra-headers] (str k ": " v "\n")))]
     (fs/create-dirs tmp-dir)
     (spit (str draft)
           (str "type: git_handoff\n"
                "to: " role "\n"
                "priority: 00\n"
                "task: " task "\n"
                "commit: " commit "\n"
                extra-lines))
     (let [result (process/sh {:dir root
                               :extra-env {"SWARMFORGE_ROLE"
                                           (or (not-empty (System/getenv "SWARMFORGE_ROLE"))
                                               "coordinator")}}
                              (str (fs/path script-dir "swarm_handoff.sh"))
                              (str draft))]
       (when-not (zero? (:exit result))
         (exit! 1 (str "Failed to queue handoff:\n" (:err result))))
       (str/trim (:out result))))))

(defn log-event! [root entry]
  (spit (str (fs/path root ".swarmforge" "run-log.jsonl"))
        (str (json/generate-string entry) "\n")
        :append true))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT)
           (java.time.Instant/now)))
