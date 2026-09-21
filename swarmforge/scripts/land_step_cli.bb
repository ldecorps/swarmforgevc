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
;;   BL-1481: also one "CONTENT_CLEAR_SIBLING_PATH <path> <ticket-id>" line
;;   per shared path where a commit-attribution blocker (bounced, withheld,
;;   awaiting approval, or unreadable) was NOT refused, because the tip's
;;   content versus origin/main carries no line attributable to it - the
;;   sibling shares the path in history only, not in content, so it rides
;;   as an ordinary own path rather than escalating. BL-1594: the line
;;   also names WHICH of the two cleared it - "landed" (the sibling's own
;;   surviving lines already match origin/main under whatever sha put them
;;   there) or "reverted" (the sibling's own contribution to this path is
;;   entirely gone at the tip, so the path owes it nothing).
;; Exit 1, prints "LAND_ESCALATE" then the reason on the next line: the
;;   detection or replay itself could not be completed cleanly (a real
;;   conflict, an unreadable range). Per QA.prompt: not a bounce to the
;;   author - a `note` (priority 00) to the specifier naming the
;;   conflicting paths, and stop.
;;
;; BL-1678: land_step_cli.bb verify-push <commit> <repo-root>
;;   The publish step's own backstop (land_step_lib.bb's verify-push-safe) -
;;   never a second decision-maker in place of land-plan, an independent
;;   check of whatever sha land_main_publish.sh is about to push, however
;;   it was built and whoever built it. Exit 0, prints "LAND_PUBLISH_OK
;;   <commit>": exactly one parent, and every path <commit> changes against
;;   origin/main is attributed to <commit>'s own ticket or to a ticket
;;   already closed on origin/main. Exit 1, prints "LAND_PUBLISH_REFUSED
;;   <reason>": a merge commit, a commit whose subject names no ticket, or
;;   the first offending path and the unapproved ticket it is attributed
;;   to (BL-1678 invariant 1/2).
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

(def usage-text "Usage: land_step_cli.bb <task-name> <commit> [repo-root]\n   or: land_step_cli.bb repoint <repo-root>\n   or: land_step_cli.bb verify-push <commit> [repo-root]")

(defn- verify-push-verb [commit repo-root-arg]
  (when (str/blank? commit)
    (binding [*out* *err*] (println usage-text))
    (System/exit 2))
  (let [project-root (or repo-root-arg
                          (let [res (process/sh ["git" "rev-parse" "--show-toplevel"])]
                            (when (zero? (:exit res)) (str/trim (:out res)))))]
    (when-not project-root
      (binding [*out* *err*] (println "Cannot resolve repo root; pass it explicitly."))
      (System/exit 2))
    (let [canonical (let [res (process/sh ["git" "-C" (str project-root) "rev-parse" commit])]
                       (when (zero? (:exit res)) (str/trim (:out res))))]
      (when-not canonical
        (binding [*out* *err*] (println (str "Cannot resolve commit: " commit)))
        (System/exit 2))
      (let [{:keys [safe? reason]} (land-step-lib/verify-push-safe {:root project-root :commit canonical})]
        (if safe?
          (do (println (str "LAND_PUBLISH_OK " canonical)) (System/exit 0))
          (do (println (str "LAND_PUBLISH_REFUSED " reason)) (System/exit 1)))))))

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

;; BL-1463: one ENTANGLED_SIBLING-printing block for both outcomes that can
;; carry :unlanded - :replay always could; :escalate now can too, when
;; land-plan's own-paths-unreadable branch already had entangled-siblings'
;; evidence in hand (BL-1272's own report contract: naming never depends on
;; which action follows).
(defn- print-entangled-siblings! [plan]
  (doseq [id (sort (:unlanded plan))] (println (str "ENTANGLED_SIBLING " id))))

(defn- canonicalize-commit [project-root commit]
  (let [res (process/sh ["git" "-C" (str project-root) "rev-parse" commit]) ]
    (when (zero? (:exit res)) (str/trim (:out res)))))

;; BL-1678: :land and :replay now share this exact same body - land-plan
;; builds a real tip-pure commit for BOTH, so a clean tip owes the caller
;; every line a replay always did (stray evidence, restored/retired
;; register rows, the sibling report) rather than the silent single-line
;; LAND_CLEAN this used to print instead of ever reaching any of it. Only
;; the header line differs; print-plan-body! is that whole shared tail.
(defn- print-plan-body! [project-root task-name task-ticket-id canonical plan]
  ;; BL-1334: record WHICH approved source this build stands in for,
  ;; before announcing it - see the docstring this comment replaced for
  ;; the full rationale, unchanged by BL-1678 beyond now also covering
  ;; :land (a clean tip is landed under a NEW sha too, never `canonical`
  ;; itself, so it needs exactly the same record a replay always got).
  (let [rec (land-step-lib/record-land-approval!
             {:root project-root :commit (:commit plan)
              :source canonical :task-ticket-id task-ticket-id})]
    (when-not (:ok? rec)
      (binding [*out* *err*]
        (println (str "LAND_APPROVAL_UNRECORDED " (:reason rec))))))
  ;; BL-1650 items 1-2: names every closed-owner pure-evidence stray this
  ;; land step cherry-picked onto the build branch itself, ahead of the
  ;; parcel's own tip-pure commit - never landed silently (Article 1.9's
  ;; own posture, same as the ENTANGLED_SIBLING/LANDED_SIBLING lines below).
  (doseq [{:keys [sha landed-sha paths already-applied? superseded? reason]} (:stray-landed plan)]
    (cond
      ;; BL-1670: a real conflict main's own later text already
      ;; supersedes never lands a NEW commit either - named with
      ;; the ground it was decided on (a fixed tag for ground
      ;; (a), the rewriting commit's own short sha(s) for
      ;; ground (b)), never silently folded into an ordinary
      ;; LANDED line (Article 1.9's own posture).
      superseded?
      (println (str "LAND_STRAY_SUPERSEDED " sha " " (str/join "," (sort paths)) " " reason))

      ;; BL-1650 D1: an already-applied stray (content identical
      ;; to the target tree under a different sha - git's own
      ;; "now empty" cherry-pick) never lands a NEW commit, so
      ;; it is never printed as LANDED - a distinct, equally
      ;; auditable tag names the sha it never needed to move.
      already-applied?
      (println (str "LAND_STRAY_EVIDENCE_ALREADY_LANDED " sha " already at " landed-sha " "
                    (str/join "," (sort paths))))

      :else
      (println (str "LAND_STRAY_EVIDENCE_LANDED " sha " -> " landed-sha " "
                    (str/join "," (sort paths))))))
  ;; BL-1604: names every other open ticket's registry row the
  ;; build restored - a land can no longer silently un-own a
  ;; standing red.
  (doseq [{:keys [registry file owner]} (:restored-registry-rows plan)]
    (println (str land-step-lib/register-row-restored-prefix " " registry " " file " " owner)))
  ;; BL-1631: names every row this land retired because its own
  ;; owner column was the landing ticket - the register no
  ;; longer trips the unowned-row throttle within minutes.
  (doseq [{:keys [registry file owner]} (:retired-registry-rows plan)]
    (println (str land-step-lib/register-row-retired-prefix " " registry " " file " " owner)))
  (print-entangled-siblings! plan)
  ;; BL-1389 invariant 3. The verdict a human would otherwise
  ;; have to re-derive by diffing the built tip - which path
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
  (doseq [{:keys [path sibling verdict]} (sort-by (juxt :path :sibling) (:content-clear plan))]
    (println (str "CONTENT_CLEAR_SIBLING_PATH " path " " sibling " "
                  (if (= :vacuous verdict) "reverted" "landed")))))

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
            ;; BL-1678: land-plan builds the SAME tip-pure own-paths/replay!
            ;; commit for :land as it always did for :replay - :commit is
            ;; that build's own sha, never `canonical` (the commit QA cited,
            ;; which may since have grown a merge or two QA never re-checked
            ;; - the TOCTOU gap a bare "print canonical back" left open).
            :land
            (do
              (println (str "LAND_CLEAN " (:commit plan)))
              (print-plan-body! project-root task-name task-ticket-id canonical plan)
              (System/exit 0))

            ;; BL-1447: land-plan already built AND verified the tip-pure
            ;; commit before returning :replay - :commit/:branch are that
            ;; already-built result, never a second replay! call (which
            ;; would collide on the branch name land-plan already claimed).
            :replay
            (do
              (println (str "LAND_REPLAY " (:branch plan) " " (:commit plan)))
              (print-plan-body! project-root task-name task-ticket-id canonical plan)
              (System/exit 0))

            :escalate
            (do
              (println "LAND_ESCALATE")
              ;; BL-1447/BL-1463: an escalate that carries :unlanded (own-
              ;; paths' attribution read failed, or a replay was attempted
              ;; and failed to build/build complete) still owes the
              ;; specifier the same sibling-adjudication context QA.prompt's
              ;; own note-writing step reads - the same ENTANGLED_SIBLING
              ;; lines and note a replay would have printed for the same
              ;; evidence (BL-1272 invariant 1: naming never depends on
              ;; which action follows). An escalate from earlier in the plan
              ;; (a bare warning, no entanglement evidence gathered; or no
              ;; ticket id at all) carries no :unlanded and prints none.
              (when (contains? plan :unlanded)
                (print-entangled-siblings! plan)
                (println (land-step-lib/entanglement-note task-name (:unlanded plan))))
              (println (:reason plan))
              (System/exit 1))))))))

(defn -main [& args]
  (cond
    (= "repoint" (first args)) (repoint-verb (second args))
    (= "verify-push" (first args)) (verify-push-verb (second args) (nth args 2 nil))
    :else (main-land args)))

(apply -main *command-line-args*)
