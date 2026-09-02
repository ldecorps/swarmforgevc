#!/usr/bin/env bb
;; BL-1241: the shell-callable land step - what QA.prompt's own BL-1241
;; section directs QA to run instead of bouncing an entangled tip to its
;; author. Thin IO/argv wrapper over land_step_lib.bb's land-plan/replay! -
;; never a second implementation of the detection or replay logic.
;;
;; Usage: land_step_cli.bb <task-name> <commit> [repo-root]
;;
;; Exit 0, prints "LAND_CLEAN <commit>": no entangled sibling found. QA
;;   proceeds with its own ordinary land action on <commit> unchanged.
;; Exit 0, prints "LAND_REPLAY <branch> <new-commit>" then one
;;   "ENTANGLED_SIBLING <ticket-id>" line per sibling still unlanded, and one
;;   "LANDED_SIBLING <ticket-id>" line per sibling whose own content is
;;   already byte-identical on origin/main (BL-1272 - its original commit
;;   remains an ancestor, so the replay is still the right action, but it is
;;   nothing left for anyone to adjudicate): a tip-pure commit was
;;   built on <branch>, off origin/main, containing only this ticket's own
;;   paths. QA reviews <branch>'s tip and lands THAT commit (never the
;;   originally-cited one), and records `abandoned_commits: [<cited
;;   commit>]` on the ticket per swarmforge/backlog-schema.md.
;; Exit 1, prints "LAND_ESCALATE" then the reason on the next line: the
;;   detection or replay itself could not be completed cleanly (a real
;;   conflict, an unreadable range). Per QA.prompt: not a bounce to the
;;   author - a `note` (priority 00) to the specifier naming the
;;   conflicting paths, and stop.

(ns land-step-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "land_step_lib.bb")))

(def usage-text "Usage: land_step_cli.bb <task-name> <commit> [repo-root]")

(defn- resolve-repo-root [explicit]
  (or explicit
      (let [res (process/sh ["git" "rev-parse" "--show-toplevel"])]
        (when (zero? (:exit res)) (str/trim (:out res))))))

(defn- canonicalize-commit [project-root commit]
  (let [res (process/sh ["git" "-C" (str project-root) "rev-parse" commit]) ]
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
        (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
              plan (land-step-lib/land-plan {:root project-root :commit canonical :task-ticket-id task-ticket-id})]
          (case (:action plan)
            :land
            (do (println (str "LAND_CLEAN " canonical)) (System/exit 0))

            :replay
            (let [result (land-step-lib/replay! {:root project-root :commit canonical
                                                  :task-ticket-id task-ticket-id
                                                  :own-paths (:own-paths plan)})]
              (if (:success result)
                (do
                  ;; BL-1334: record WHICH approved source this replay stands
                  ;; in for, before announcing it. The replay is a new commit
                  ;; that no ref makes approved, so without this record every
                  ;; ancestry-based gate reads QA's own landed work as
                  ;; unapproved until an unrelated later merge closes the
                  ;; window - and the override becomes the habit.
                  ;;
                  ;; A failure here is REPORTED, never fatal: the land itself
                  ;; is sound, and an unrecorded land degrades to exactly the
                  ;; pre-BL-1334 behaviour (the sanctioned --override), never
                  ;; to a wrong approval.
                  (let [rec (land-step-lib/record-land-approval!
                             {:root project-root :commit (:commit result)
                              :source canonical :task-ticket-id task-ticket-id})]
                    (when-not (:ok? rec)
                      (binding [*out* *err*]
                        (println (str "LAND_APPROVAL_UNRECORDED " (:reason rec))))))
                  (println (str "LAND_REPLAY " (:branch result) " " (:commit result)))
                  (doseq [id (sort (:unlanded plan))] (println (str "ENTANGLED_SIBLING " id)))
                  (doseq [id (sort (:landed plan))] (println (str "LANDED_SIBLING " id)))
                  (System/exit 0))
                (do
                  (println "LAND_ESCALATE")
                  (println (land-step-lib/entanglement-note task-name (:unlanded plan)))
                  (println (:reason result))
                  (System/exit 1))))

            :escalate
            (do
              (println "LAND_ESCALATE")
              (println (:reason plan))
              (System/exit 1))))))))

(apply -main *command-line-args*)
