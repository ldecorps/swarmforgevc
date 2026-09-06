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
;;   "LANDED_SIBLING <ticket-id> <deciding-path>" line per sibling whose own
;;   content is already on origin/main (BL-1272 - its original commit
;;   remains an ancestor, so the replay is still the right action, but it is
;;   nothing left for anyone to adjudicate; BL-1389 appends the path the
;;   verdict rests on, so it can be checked without diffing the tip), and one
;;   "EXCLUDED_SIBLING_PATH <path> <ticket-id>" line per delivered path left
;;   OUT of the replay, naming the sibling it was credited to (BL-1389: the
;;   report used to print names and no paths, so a path an unlanded sibling
;;   owned alone could ride into the replay unseen): a tip-pure commit was
;;   built on <branch>, off origin/main, containing only this ticket's own
;;   paths. QA reviews <branch>'s tip and lands THAT commit (never the
;;   originally-cited one), and records `abandoned_commits: [<cited
;;   commit>]` on the ticket per swarmforge/backlog-schema.md.
;;   BL-1375: also one "PASSENGER_SIBLING <ticket-id>" line per APPROVED
;;   unlanded sibling whose own lines ride into main on a path this replay
;;   had to take whole. A shared blob cannot be split per-hunk, so a
;;   co-owned path carries them; the replayed tree was run through the land
;;   step's tree guards before this line was printed, but QA still owes each
;;   named sibling the same `abandoned_commits:` bookkeeping its own land
;;   would have produced. A sibling that is withheld, awaiting approval, or
;;   whose approval state cannot be read never rides - it escalates below.
;; Exit 1, prints "LAND_ESCALATE" then the reason on the next line: the
;;   detection or replay itself could not be completed cleanly (a real
;;   conflict, an unreadable range). Per QA.prompt: not a bounce to the
;;   author - a `note` (priority 00) to the specifier naming the
;;   conflicting paths, and stop.
;;
;; BL-1438: land_step_cli.bb repoint <repo-root>
;;   Thin wrapper over land_step_lib.bb's post-land-repoint! (BL-1432
;;   option 1) - the QA-branch re-point, built and tested with no live
;;   caller until this verb. Prints exactly one line and exits 0 whichever
;;   way post-land-repoint! decides (a skip is a decision, not a failure -
;;   invariant 2): "LAND_REPOINTED <old-tip> <new-tip>" on success, or
;;   "LAND_REPOINT_SKIPPED <reason>" when post-land-repoint!'s own guards
;;   refuse (an uncommitted change, a parcel still in_process, or
;;   origin/main not resolving - BL-1432 invariant 3; this verb adds no
;;   second notion of clean). Exits non-zero ONLY when <repo-root> itself
;;   cannot be read as a git repository - proved with `rev-parse
;;   --git-common-dir` before any mutating git call, per BL-1390 - never
;;   when the re-point itself decides to skip.

(ns land-step-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "land_step_lib.bb")))

(def usage-text "Usage: land_step_cli.bb <task-name> <commit> [repo-root]\n   or: land_step_cli.bb repoint <repo-root>")

(defn- repoint-verb [repo-root-arg]
  (when (str/blank? repo-root-arg)
    (binding [*out* *err*] (println usage-text))
    (System/exit 2))
  (let [root (str repo-root-arg)
        common-dir-check (process/sh ["git" "-C" root "rev-parse" "--git-common-dir"])]
    (if-not (zero? (:exit common-dir-check))
      (do
        (binding [*out* *err*] (println (str "Cannot read repo root as a git repository: " root)))
        (System/exit 2))
      (let [result (land-step-lib/post-land-repoint! {:root root})]
        (case (:action result)
          :repointed (println (str "LAND_REPOINTED " (:old-tip result) " " (:new-tip result)))
          :skipped (println (str "LAND_REPOINT_SKIPPED " (:reason result))))
        (System/exit 0)))))

(defn- resolve-repo-root [explicit]
  (or explicit
      (let [res (process/sh ["git" "rev-parse" "--show-toplevel"])]
        (when (zero? (:exit res)) (str/trim (:out res))))))

(defn- canonicalize-commit [project-root commit]
  (let [res (process/sh ["git" "-C" (str project-root) "rev-parse" commit]) ]
    (when (zero? (:exit res)) (str/trim (:out res)))))

(defn- main-land [args]
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
              ;; BL-1431: resolved ONCE, here, at the true entry point of this
              ;; land-step invocation - land-plan and, when it decides
              ;; :replay, replay! both receive this SAME sha rather than each
              ;; re-resolving origin/main by name mid-walk. A mint landing on
              ;; origin/main between land-plan's own read and own-paths' used
              ;; to desync the attribution map own-paths reads from the walk
              ;; that built it, escalating on a commit that never entered the
              ;; range (BL-1416 twice, BL-1407 once, 2026-09-05).
              origin-main (land-step-lib/origin-main-sha project-root)
              plan (land-step-lib/land-plan {:root project-root :commit canonical
                                              :task-ticket-id task-ticket-id
                                              :origin-main origin-main})]
          (case (:action plan)
            :land
            (do (println (str "LAND_CLEAN " canonical)) (System/exit 0))

            :replay
            (let [result (land-step-lib/replay! {:root project-root :commit canonical
                                                  :task-ticket-id task-ticket-id
                                                  :own-paths (:own-paths plan)
                                                  ;; BL-1375 invariant 2: replay! runs the
                                                  ;; tree guards against the replayed tree
                                                  ;; before handing back a commit, and only
                                                  ;; when a passenger actually rides.
                                                  :passengers (:passengers plan)
                                                  :origin-main origin-main})]
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
                  ;; BL-1389 invariant 3. The verdict a human would otherwise
                  ;; have to re-derive by diffing the replayed tip: which path
                  ;; decided each landed sibling, and which paths were left out
                  ;; and to whom they were credited. On 2026-09-04 this report
                  ;; printed 17 landed names and 27 entangled ones and not one
                  ;; path, and an unlanded sibling's handler and source rode
                  ;; into the replay unseen.
                  (doseq [id (sort (:landed plan))]
                    (let [deciding (get (:landed-paths plan) id)]
                      (println (str "LANDED_SIBLING " id (when deciding (str " " deciding))))))
                  (doseq [{:keys [path owners]} (sort-by :path (:excluded plan))
                          owner (sort owners)]
                    (println (str "EXCLUDED_SIBLING_PATH " path " " owner)))
                  (doseq [id (sort (:passengers plan))] (println (str "PASSENGER_SIBLING " id)))
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

(defn -main [& args]
  (if (= "repoint" (first args))
    (repoint-verb (second args))
    (main-land args)))

(apply -main *command-line-args*)
