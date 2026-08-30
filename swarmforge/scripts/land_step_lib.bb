;; land_step_lib.bb — BL-1241: the land step's own remedy for an entangled
;; tip, replacing "bounce it to the author" (an outcome no role can act on:
;; no role can remove commits that are ancestors of its own branch).
;;
;; A parcel's cited commit routinely has OTHER tickets' unlanded work as a
;; first-parent ancestor - ordinary pipelining on a long-lived role branch,
;; not misconduct. Landing it as-is would put that unreviewed sibling work
;; on `main` (the BL-506 refusal); bouncing it back to the author fixes
;; nothing, since the author cannot un-ancestor commits already on their own
;; branch. Five bounces in two days (BL-1227/1192/1201, then BL-1238/1247)
;; each stalled with no move available to anyone.
;;
;; Ruling (specifier, 2026-08-29, swarmforge/roles/QA.prompt): QA itself
;; replays only the cited ticket's own paths onto current `origin/main` and
;; lands THAT commit, recording `abandoned_commits:` on the ticket - never a
;; bounce. This lib provides the DETECTION half (is the tip entangled, with
;; whom) and the REPLAY-BUILD half (construct the tip-pure commit as a local
;; git object, never pushed - landing `main`/pushing origin stays QA's own
;; final, human-observed action per Article 1.8, same posture as every other
;; gate lib in this file's family that decides but never pushes).
;;
;; Reuses task_scope_gate_lib.bb's OWN already-shipped, already-tested walk
;; (task-tagged-changed-paths, BL-1192) for "this ticket's own paths" -
;; never a second implementation of that walk, invariant 2's own shape
;; applied one door down. The sibling-detection walk below is NEW (a
;; different range: origin/main..commit, unfiltered, to see who ELSE is in
;; there) but shares the SAME ticket-id extractor
;; (pipeline-stage-lib/extract-ticket-id) - the "small live-glue duplicated
;; across independent pure libs, one shared extractor" posture
;; chase_sweep_lib.bb's own header already documents for this exact shape.

(ns land-step-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_scope_gate_lib.bb")))

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

;; nil signals "origin/main could not be resolved" - the caller's fail-open,
;; mirroring task_scope_gate_lib.bb's own origin-main-sha exactly (never a
;; guessed sha).
(defn origin-main-sha [root]
  (let [res (git! root "rev-parse" "-q" "--verify" "origin/main^{commit}")]
    (when (zero? (:exit res)) (str/trim (:out res)))))

(defn- commit-subject [root commit]
  (let [res (git! root "log" "-1" "--format=%s" commit)]
    (when (zero? (:exit res)) (str/trim (:out res)))))

(defn commit-ticket-id
  "The ticket id this commit's own subject names (pipeline-stage-lib's
   single-match, first-token-wins extractor - the same one task_scope_gate_
   lib.bb's commit-message-names-task? and this repo's other commit-
   attribution guards already share). nil when the subject names none, or
   the commit cannot be read - never guessed."
  [root commit]
  (when-let [subject (commit-subject root commit)]
    (pipeline-stage-lib/extract-ticket-id subject)))

;; nil (never []) signals "the walk itself failed" - same fail-open
;; contract task_scope_gate_lib.bb's own task-tagged-changed-paths uses.
(defn- ancestry-commits [root base commit]
  (let [res (git! root "rev-list" "--first-parent" (str base ".." commit))]
    (when (zero? (:exit res))
      (remove str/blank? (str/split-lines (:out res))))))

(defn- blob-at
  "The blob id `rev` holds at `path`, or ::absent when it holds none. A path
   absent on BOTH sides is byte-identical in the only sense that matters here:
   a sibling whose landed content was a deletion really is landed."
  [root rev path]
  (let [res (git! root "rev-parse" "--verify" "-q" (str rev ":" path))]
    (if (zero? (:exit res)) (str/trim (:out res)) ::absent)))

(defn sibling-landed?
  "Pure over the injected facts: is this sibling's attributed content ALREADY
   on origin/main, byte for byte?

   BL-1272, invariant 1: landed is a POSITIVE finding, never an inference from
   silence. `paths` nil (the attribution walk could not run) and `paths` empty
   (nothing was attributed to the sibling at all) both mean the question was
   not answered, and an unanswered question reports the sibling as entangled -
   the same fail-closed posture entangled-siblings' own warning path takes.

   Deliberately NOT a subject grep over origin/main's history: a mint or spec
   commit names a ticket while its pipeline work is still unlanded, so a
   subject match would suppress a REAL entanglement and turn a fail-closed
   check fail-open."
  [{:keys [paths complete? same-content?]}]
  (boolean (and complete? (seq paths) (every? same-content? paths))))

(defn- diff-readable? [root commit]
  (zero? (:exit (git! root "diff-tree" "--no-commit-id" "--name-only" "-r" "--first-parent" commit))))

(defn attribution-complete?
  "Every commit in `candidates` that names `sibling-id` can actually be
   diffed.

   This is not belt-and-braces. task-tagged-changed-paths signals failure with
   nil ONLY when the commit walk itself fails; a single commit whose diff
   cannot be computed silently contributes no paths, shrinking the attributed
   set instead of emptying it. Without this probe a sibling whose READABLE
   half is already on origin/main would be reported as landed on a check that
   never saw its other half - invariant 1's \"partial\" row, fail-open."
  [root candidates sibling-id]
  (every? (fn [c]
            (or (not= sibling-id (commit-ticket-id root c))
                (diff-readable? root c)))
          candidates))

(defn landed-siblings
  "The subset of `siblings` whose attributed content between origin/main and
   `commit` is already byte-identical in origin/main's tree.

   Attribution reuses task_scope_gate_lib.bb's own walk (BL-1192), the same
   one `own-paths` delegates to - never a second implementation. `paths-fn` is
   injected so the walk-failed row is drivable without corrupting a
   repository; it defaults to that real walk."
  ([root commit origin-main candidates siblings]
   (landed-siblings root commit origin-main candidates siblings nil))
  ([root commit origin-main candidates siblings paths-fn]
   (let [walk (or paths-fn
                  #(task-scope-gate-lib/task-tagged-changed-paths root origin-main commit %))
         same-content? (fn [p] (= (blob-at root commit p) (blob-at root origin-main p)))]
     (->> siblings
          (filter #(sibling-landed?
                    {:paths (walk %)
                     :complete? (attribution-complete? root candidates %)
                     :same-content? same-content?}))
          set))))

(defn entangled-siblings
  "{:entangled #{ticket-ids} :landed #{...} :unlanded #{...} :warning nil} on a
   clean read, or {:entangled nil :warning \"...\"} when the walk could not be
   completed -
   never a silent empty set standing in for 'could not check' (this
   ticket's own invariant 2: a commit must not land while another ticket's
   unreviewed work is an ancestor of it - a check that could not run must
   never be read as 'nothing found'). Every commit in origin/main..commit
   whose OWN subject names a DIFFERENT ticket than task-ticket-id counts;
   a commit naming no ticket at all is not counted (positive identification
   only, task_scope_gate_lib.bb's own posture - never guessed as
   entanglement from silence)."
  [root commit task-ticket-id]
  (if-let [origin-main (origin-main-sha root)]
    (let [candidates (ancestry-commits root origin-main commit)]
      (if (nil? candidates)
        {:entangled nil :warning (str "land-step: could not read the commit range origin/main.." commit)}
        (let [siblings (->> candidates
                            (keep #(commit-ticket-id root %))
                            (remove #(= % task-ticket-id))
                            set)
              landed (landed-siblings root commit origin-main candidates siblings)]
          ;; :entangled stays the FULL set - it is what land-plan decides on,
          ;; and BL-1272 invariant 2 keeps that decision unchanged. :landed and
          ;; :unlanded are the reporting split: a sibling's original commit is
          ;; still an ancestor after its replay lands, and may carry content
          ;; the replay deliberately excluded, so landing as cited would
          ;; resurrect exactly what the replay severed.
          {:entangled siblings
           :landed landed
           :unlanded (into #{} (remove landed siblings))
           :warning nil})))
    {:entangled nil :warning "land-step: origin/main could not be resolved"}))

(defn own-paths
  "This ticket's own changed paths since origin/main - the tip-pure replay
   content (BL-1241's remedy (b)). Delegates to task_scope_gate_lib.bb's
   OWN already-shipped walk (BL-1192), based at origin/main instead of the
   last-handoff boundary that function's default caller uses - the exact
   parameterisation it already exposes, never a reimplementation. nil
   (never []) on an unreadable range, mirroring that function's own
   contract."
  [root commit task-ticket-id]
  (when-let [origin-main (origin-main-sha root)]
    (task-scope-gate-lib/task-tagged-changed-paths root origin-main commit task-ticket-id)))

(defn land-plan
  "The land step's own decision: {:action :land} when no entanglement is
   present (or the check could not tell - see below); {:action :replay
   :entangled #{...} :own-paths [...]} when a tip-pure rebuild is the
   remedy; {:action :escalate :reason \"...\"} when even the detection
   itself could not be completed - a check that cannot run refuses to bless
   a land, per invariant 2, rather than defaulting to :land.
   task-ticket-id nil (task-name named no ticket) also escalates - nothing
   to compare ancestry against."
  [{:keys [root commit task-ticket-id]}]
  (if-not task-ticket-id
    {:action :escalate :reason "land-step: task name names no ticket id"}
    (let [{:keys [entangled landed unlanded warning]} (entangled-siblings root commit task-ticket-id)]
      (cond
        warning {:action :escalate :reason warning}
        (empty? entangled) {:action :land}
        :else
        (let [paths (own-paths root commit task-ticket-id)]
          (if (nil? paths)
            {:action :escalate :reason (str "land-step: could not compute " task-ticket-id "'s own paths to replay")}
            {:action :replay :entangled entangled :landed landed :unlanded unlanded
             :own-paths paths}))))))

(defn entanglement-note
  "The text QA sends when replay itself cannot be completed cleanly (BL-1241
   qa_e2e_procedure / QA.prompt step 3: a note to the specifier, priority
   00, never a bounce to the parcel's author) - names every sibling ticket
   that is STILL unlanded, the actionable content invariant 1 requires.
   BL-1272: a sibling whose work is already on origin/main is not an
   adjudication request, so naming it would send the specifier to settle
   something already settled."
  [task-name unlanded]
  (if (seq unlanded)
    (format "%s: entangled tip - sibling ticket(s) %s unlanded as ancestors, tip-pure replay could not complete cleanly; specifier adjudication needed."
            task-name (str/join "," (sort unlanded)))
    (format "%s: entangled tip - every ancestor sibling ticket has already landed, but the tip-pure replay could not complete cleanly; specifier adjudication needed."
            task-name)))

;; ── replay: build the tip-pure commit as a local git object ──────────────
;; Never pushes, never fast-forwards `main`/origin - QA's own land action
;; (Article 1.8) stays the human-observed final step. This only produces
;; the commit for QA to review and then land itself.

(defn- write-tree-from-paths! [root cited-commit paths]
  "Applies each path's content AT cited-commit onto the CURRENT index/
   worktree - `git checkout <cited-commit> -- <path>` per path (also
   handles deletions: a path task-tagged-changed-paths names but no longer
   present at cited-commit is removed). Returns true on success."
  (let [ok (atom true)]
    (doseq [p paths]
      (let [show (git! root "cat-file" "-e" (str cited-commit ":" p))]
        (if (zero? (:exit show))
          (let [res (git! root "checkout" cited-commit "--" p)]
            (when-not (zero? (:exit res)) (reset! ok false)))
          (let [res (git! root "rm" "-q" "--ignore-unmatch" "--" p)]
            (when-not (zero? (:exit res)) (reset! ok false))))))
    @ok))

(defn replay!
  "Builds a tip-pure commit for task-ticket-id's own-paths, on top of
   origin/main, in a DEDICATED linked worktree
   (.git/land-replay-worktrees/<task-ticket-id>-<short cited-commit>, off
   a scratch branch land-replay/<task-ticket-id>-<short cited-commit>) -
   never a checkout in the caller's own worktree, which may be mid-work
   with real uncommitted changes QA cannot risk disturbing. Returns
   {:success true :commit sha :branch name} or {:success false :reason
   \"...\"} - never throws. The scratch worktree is always removed before
   returning, success or failure alike; the branch itself survives success
   (QA's own land action reads it) and is deleted on failure."
  [{:keys [root commit task-ticket-id own-paths]}]
  (let [origin-main (origin-main-sha root)]
    (if (nil? origin-main)
      {:success false :reason "land-step replay: could not resolve origin/main"}
      (let [branch (str "land-replay/" task-ticket-id "-" (subs commit 0 (min 10 (count commit))))
            scratch (str (fs/path root ".git" "land-replay-worktrees" (str task-ticket-id "-" (subs commit 0 (min 10 (count commit))))))
            cleanup! (fn []
                       (git! root "worktree" "remove" "-f" scratch)
                       (fs/delete-tree scratch {:force true}))
            create (git! root "worktree" "add" "-q" "-b" branch scratch origin-main)]
        (if-not (zero? (:exit create))
          {:success false :reason (str "land-step replay: could not create worktree " scratch " off origin/main")}
          (let [applied? (write-tree-from-paths! scratch commit own-paths)]
            (if-not applied?
              (do (cleanup!)
                  (git! root "branch" "-q" "-D" branch)
                  {:success false :reason (str "land-step replay: could not apply " task-ticket-id "'s own paths from " commit)})
              (let [commit-res (git! scratch "-c" "user.email=t@t" "-c" "user.name=t"
                                      "commit" "-q" "-m" (str task-ticket-id ": tip-pure replay onto origin/main (BL-1241 land-step remedy)"))]
                (if-not (zero? (:exit commit-res))
                  (do (cleanup!)
                      (git! root "branch" "-q" "-D" branch)
                      {:success false :reason (str "land-step replay: nothing to commit for " task-ticket-id " - own-paths identical to origin/main")})
                  (let [sha (str/trim (:out (git! scratch "rev-parse" "HEAD")))]
                    (cleanup!)
                    {:success true :commit sha :branch branch}))))))))))
