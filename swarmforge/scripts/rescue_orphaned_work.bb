#!/usr/bin/env bb
;; rescue_orphaned_work.bb — BL-1041: rescue work that is sitting outside any
;; branch, ONTO a branch, before releasing the source.
;;
;;   rescue_orphaned_work.bb <project-root> --stash <ref> --role <role>
;;                           --reason <text> [--dry-run]
;;
;; The ordering is the whole point and is taken from rescue_lib's plan rather
;; than from this file's control flow: commit, verify the content by reading it
;; back OUT of the commit, and only then drop the stash. Interrupted anywhere
;; before that, the stash entry is still there and nothing has been lost.
;;
;; Then the owner of the worktree is told what landed and why - because a role
;; may not sweep changes it did not make, so unattributed work in its tree
;; costs it a turn it cannot avoid.

(ns rescue-orphaned-work
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "rescue_lib.bb")))

(defn- git [dir & args]
  (apply process/sh {:dir (str dir) :continue true} "git" args))

(defn- git-ok? [r] (zero? (:exit r)))

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: rescue_orphaned_work.bb <project-root> --stash <ref> --role <role> --reason <text> [--dry-run]"))
  (System/exit 2))

(defn- opt [argv flag]
  (second (drop-while #(not= % flag) argv)))

(defn -main [& argv]
  (let [root (first argv)
        stash (opt argv "--stash")
        role (opt argv "--role")
        reason (or (opt argv "--reason") "orphaned work rescue")
        dry? (boolean (some #{"--dry-run"} argv))]
    (when (or (str/blank? (str root)) (str/blank? (str stash)) (str/blank? (str role)))
      (usage!))
    (let [worktree (str (fs/path root ".worktrees" role))
          worktree (if (fs/exists? worktree) worktree (str root))
          plan (rescue-lib/rescue-plan {:role role :paths [] :reason reason})]

      (when dry?
        (println "DRY RUN - would run, in this order:")
        (doseq [{:keys [step guard]} plan]
          (println (str "  " (name step) (when guard (str " (guarded by " (name guard) ")")))))
        (System/exit 0))

      ;; 0. READ THE SOURCE'S OWN PATH SET, before touching the worktree.
      ;;
      ;; Architect bounce, 2026-08-22: the first version derived this from
      ;; `git diff --name-only HEAD` AFTER the apply - "everything currently
      ;; uncommitted in the tree" rather than "what this stash contains" - and
      ;; that was wrong two ways, both reproduced end to end:
      ;;
      ;;   D1a it swept the receiving role's OWN pre-existing uncommitted work
      ;;       into the rescue commit, under a message describing something
      ;;       else. That is the exact harm this ticket exists to prevent, now
      ;;       automated rather than manual.
      ;;   D1b `git diff` never reports untracked files, so a stash carrying a
      ;;       brand-new file came back empty: the CLI applied it (the file
      ;;       landed on disk), refused with "changed no tracked file" - which
      ;;       was factually wrong - and left that file untracked and
      ;;       unaccounted for in someone else's tree.
      ;;
      ;; `--include-untracked` covers both, and is read from the SOURCE, so the
      ;; state of the receiving worktree cannot contaminate it. It is also safe
      ;; on a stash with no untracked part (verified: it still lists the
      ;; tracked paths).
      (let [listed (git worktree "stash" "show" "--include-untracked" "--name-only" stash)]
        (when-not (git-ok? listed)
          (binding [*out* *err*] (println (str "REFUSE could not read " stash ": " (str/trim (str (:err listed))))))
          (System/exit 1))
        (let [changed (->> (:out listed) str/split-lines (remove str/blank?) vec)]
          (when (empty? changed)
            (binding [*out* *err*] (println (str "REFUSE nothing to rescue: " stash " carries no files")))
            (System/exit 1))

          ;; 1. STAGE: apply the source. `apply`, never `pop` - dropping the
          ;;    source here is the defect this ticket exists for.
          (let [applied (git worktree "stash" "apply" stash)]
            (when-not (git-ok? applied)
              (binding [*out* *err*] (println (str "REFUSE could not apply " stash ": " (str/trim (str (:err applied))))))
              (System/exit 1)))

        ;; 2. COMMIT onto the role's branch. Only the paths the source touched -
        ;;    a rescue never sweeps whatever else the tree was carrying.
        (apply git worktree "add" "--" changed)
        (let [msg (str "Rescue orphaned work: " reason "\n\n"
                       "Rescued onto a branch before releasing the source (BL-1041).\n"
                       "Files: " (str/join ", " changed) "\n\nBy " role ".")
              committed (git worktree "commit" "-m" msg)]
          (when-not (git-ok? committed)
            (binding [*out* *err*] (println (str "REFUSE commit failed: " (str/trim (str (:err committed))))))
            (System/exit 1))

          (let [sha (str/trim (str (:out (git worktree "rev-parse" "--short=10" "HEAD"))))
                branch (str/trim (str (:out (git worktree "rev-parse" "--abbrev-ref" "HEAD"))))
                ;; 3. VERIFY by reading the content back OUT of the commit -
                ;;    never by trusting its subject line. A path the stash
                ;;    DELETES is verified when it is absent from both the
                ;;    commit and the disk, not by requiring it to exist: a
                ;;    stash's orphaned work can itself be a deletion, and
                ;;    `fs/exists?` would otherwise never pass for one -
                ;;    retaining a correctly rescued deletion's source forever.
                verified? (every? (fn [p]
                                    (let [in-commit (git worktree "show" (str sha ":" p))
                                          on-disk (str (fs/path worktree p))]
                                      (if (git-ok? in-commit)
                                        (and (fs/exists? on-disk)
                                             (= (str (:out in-commit)) (slurp on-disk)))
                                        (not (fs/exists? on-disk)))))
                                  changed)]

            ;; 4. RELEASE the source - guarded, never reached by falling through.
            (if (rescue-lib/source-release-allowed?
                  {:commit-sha sha :branch branch :content-verified? verified?})
              (let [dropped (git worktree "stash" "drop" stash)]
                (println (str "RESCUED " sha " on " branch " (" (count changed) " file(s)); source "
                              (if (git-ok? dropped) "released" "NOT released - drop failed, source still present"))))
              (println (str "RESCUED " sha " on " branch " (" (count changed) " file(s)); source RETAINED"
                            " - content not verified, nothing dropped")))

            ;; 5. NOTIFY the owner of the tree that was touched.
            (let [draft (rescue-lib/notification-draft
                          {:role role :paths changed :reason reason :commit-sha sha})
                  f (str (fs/path worktree "tmp" "rescue-note.txt"))]
              (fs/create-dirs (fs/parent f))
              (spit f (str "type: " (:type draft) "\nto: " (:to draft)
                           "\npriority: " (:priority draft) "\nmessage: " (:message draft) "\n"))
              (println (str "NOTE draft for " role ": " (:message draft)))
              (println (str "NOTE file: " f))))))))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
