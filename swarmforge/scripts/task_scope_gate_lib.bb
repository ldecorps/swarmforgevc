;; task_scope_gate_lib.bb — BL-1192: refuses a git_handoff whose cited
;; commit's diff against origin/main carries a path that POSITIVELY belongs
;; to a DIFFERENT ticket than the one the handoff's task: names.
;;
;; The 2026-08-27 shift logged ten `behavior` QA bounces; the measured
;; subset (BL-596, BL-754, BL-780, BL-980, BL-1173, BL-1174) shared one
;; meta-cause: a handoff naming ticket A cited a commit whose tree diff vs
;; origin/main also included another ticket's backlog YAML or feature
;; file - an entangled tip, caught only by QA's manual BL-506 inventory
;; five stages later. BL-531 already refuses this shape at the
;; documenter→QA edge; this gate arms the SAME question on every
;; `type: git_handoff` hop (cleaner, architect, hardener, documenter, QA
;; alike), so an entangled tip is refused where it first appears instead of
;; riding the pipeline to QA.
;;
;; POSITIVE IDENTIFICATION ONLY (invariant 1's "only a positive foreign-
;; ticket path overlap may refuse" - the mirror of invariant 1's own
;; fail-open-is-absolute half): a changed path counts only when its OWN
;; basename names a ticket id, via pipeline-stage-lib/extract-ticket-id -
;; the same exact-id-equality extractor task_commit_coherence_gate_lib.bb
;; (BL-953) already uses, never a second parser (invariant 2). This
;; deliberately covers backlog/**/*.yaml, backlog/evidence/*.md,
;; specs/features/*.feature and docs/how-to/*.md - the artifact shapes
;; that actually carry a ticket id in their own name, and the exact
;; shapes the six measured bounces entangled. A functional code path
;; (extension/src/foo.ts) has no deterministic id in its own name and is
;; never flagged by this gate - that silence is not evidence of clean
;; scope, only of "this gate cannot see it," which is why invariant 1's
;; fail-open covers it structurally rather than this gate guessing.
;;
;; FAIL-OPEN IS ABSOLUTE: origin/main unreadable, the diff itself
;; unreadable, the task name resolving to no ticket, or every changed path
;; resolving to no ticket (or only the task's own) - every one of these
;; accepts, same posture as BL-953/BL-972.

(ns task-scope-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "salvage_lib.bb")))

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

;; BL-1192 architect bounce D1 (2026-08-28): the literal origin/main...commit
;; range explodes into a false-positive avalanche on this repo's real git
;; topology - a role's own branch legitimately accumulates many OTHER,
;; already-forwarded tickets' commits (batch roles process several tickets
;; per turn; origin/main lags local work by design) long before origin/main
;; catches up. A first-parent-single-commit range (the previous attempt)
;; under-reaches instead, missing entanglement introduced across a chain of
;; this task's OWN commits.
;;
;; Scope actually implemented: the UNION of each commit's own tree diff,
;; walked first-parent from "the commit most recently handed off for this
;; exact task" (salvage-lib/latest-item-handoffs - the authoritative,
;; already-recorded boundary, never grepped/guessed) up to the cited commit,
;; but ONLY for commits whose own message names this task's ticket id. A
;; batch role's sibling-ticket commits interleaved in the same turn (each
;; tagged with THEIR OWN ticket id, never this one) contribute nothing -
;; this is what solves the accumulation problem empirically (verified
;; against this repo's own real cleaner batch turn, commit b033583c08:
;; origin/main...commit showed 64 paths across ~6 tickets; this scope
;; shows 1, the task's own evidence file). A commit that genuinely IS
;; tagged for this task but ALSO touches a foreign ticket's path is still
;; caught in full - the gate's actual purpose survives.
;;
;; No prior handoff recorded for this task (its very first hop) - the
;; candidate is the cited commit alone, nothing to walk back through.

;; Evidence-only paths under backlog/evidence/<task-id>-* for the NAMED
;; task never count as foreign overlap (they are the task's own
;; paperwork, not entanglement) - checked before the general id-mismatch
;; test so a task's own evidence file, which by construction names its
;; own id, is never mistaken for anything else either.
(defn- own-evidence-path? [path task-ticket-id]
  (and (str/starts-with? path "backlog/evidence/")
       (str/starts-with? (fs/file-name path) (str task-ticket-id "-"))))

(defn ticket-id-for-path
  "Positive path→ticket-id mapping (direction, per the ticket's own How
   section): the id named in this path's OWN basename, restricted to the
   artifact shapes that actually carry one - backlog/**, specs/features/**,
   and docs/how-to/** - never a functional code path, which has no
   deterministic id in its own name. nil (never a guess) for everything
   else."
  [path]
  (when (or (str/starts-with? path "backlog/")
            (str/starts-with? path "specs/features/")
            (str/starts-with? path "docs/how-to/"))
    (pipeline-stage-lib/extract-ticket-id (fs/file-name path))))

(defn foreign-scope-findings
  "Pure (BL-654-style property target): given the task's own ticket id and
   the set of changed paths, every {:path :ticket-id} pair whose path
   positively belongs to a DIFFERENT ticket - own-evidence paths for the
   task excluded. Empty when task-ticket-id is nil (nothing to compare
   against) - the caller's own fail-open, not re-derived here."
  [task-ticket-id changed-paths]
  (if-not task-ticket-id
    []
    (vec (for [path changed-paths
               :let [id (ticket-id-for-path path)]
               :when (and id
                          (not= id task-ticket-id)
                          (not (own-evidence-path? path task-ticket-id)))]
           {:path path :ticket-id id}))))

(defn- last-handoff-commit
  "The commit most recently handed off for this exact task, per the
   durable handoff archive (completed/abandoned across every role) -
   nil when this is the task's first hop, never guessed via commit-message
   grep (BL-1192 D1: a loose grep over-matches unrelated commits that
   merely mention the ticket id in passing, e.g. a batch intake note)."
  [root task-ticket-id]
  (some-> (salvage-lib/latest-item-handoffs root task-ticket-id)
          first
          (salvage-lib/header-field "commit")))

(defn- commit-message-names-task? [root commit task-ticket-id]
  ;; SUBJECT-only, exact id equality via pipeline-stage-lib's own
  ;; multi-id extractor - the same choice BL-953's task_commit_coherence_
  ;; gate_lib.bb already made and documented (commit-ticket-ids), for the
  ;; identical reason its own doc-comment states here: a full-body
  ;; substring/grep over-matches a commit whose SUBJECT belongs to one
  ;; ticket but whose body prose merely mentions this task's id in passing
  ;; (e.g. "decouple unlanded BL-1192 gate wiring" inside a BL-1227-subject
  ;; commit) - discovered live when this gate blocked its own author's
  ;; send on exactly that shape.
  (let [subj (git! root "log" "-1" "--format=%s" commit)]
    (and (zero? (:exit subj))
         (some #(= task-ticket-id %)
               (pipeline-stage-lib/extract-ticket-ids (:out subj))))))

(defn- own-commit-diff [root commit]
  (let [diff (git! root "diff-tree" "--no-commit-id" "--name-only" "-r" "--first-parent" commit)]
    (when (zero? (:exit diff))
      (remove str/blank? (str/split-lines (:out diff))))))

;; nil (never []) distinctly signals "the walk itself failed" - collapsing
;; that into the fail-open empty-findings shape would silently accept an
;; unreadable range instead of warning about it.
(defn- task-tagged-changed-paths [root base commit task-ticket-id]
  (let [candidates (if base
                      (let [log (git! root "rev-list" "--first-parent" (str base ".." commit))]
                        (when (zero? (:exit log))
                          (remove str/blank? (str/split-lines (:out log)))))
                      [commit])]
    (when candidates
      (->> candidates
           (filter #(commit-message-names-task? root % task-ticket-id))
           (mapcat #(own-commit-diff root %))
           (remove nil?)
           distinct
           vec))))

(defn findings-for-git-handoff
  "The one impure entry point. Returns {:findings [{:path :ticket-id}]} on
   a clean read (possibly empty), or {:warning \"...\"} when the walk could
   not be read - never both, mirroring parcel_rollback_guard_lib.bb's own
   contract exactly."
  [{:keys [root task-name commit]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
        unreadable-warning (delay {:warning (str "task-scope check could not run for " task-name
                                                  " (the commit history for " commit
                                                  " unreadable) - send allowed, unverified (BL-1192)")})]
    (if-not task-ticket-id
      {:findings []}
      (let [commit-check (git! root "rev-parse" "-q" "--verify" (str commit "^{commit}"))]
        (if-not (zero? (:exit commit-check))
          @unreadable-warning
          (let [base (last-handoff-commit root task-ticket-id)
                changed-paths (task-tagged-changed-paths root base commit task-ticket-id)]
            (if (nil? changed-paths)
              @unreadable-warning
              {:findings (foreign-scope-findings task-ticket-id changed-paths)})))))))

(defn blocked? [{:keys [findings]}]
  (boolean (seq findings)))

(defn refusal-message
  [{:keys [task-name findings]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
        ticket-ids (distinct (map :ticket-id findings))
        paths (map :path findings)]
    (format (str "Cannot send git_handoff for %s: this task's own commits since its last "
                 "handoff carry %s (%s) belonging to %s, not to %s - the tip is entangled with "
                 "another ticket's work (BL-1192/BL-506). Rebuild or cherry-pick a tip-pure "
                 "commit for %s and re-send.")
          task-name
          (if (= 1 (count paths)) "a path" (format "%d paths" (count paths)))
          (str/join ", " paths)
          (str/join "," ticket-ids)
          task-ticket-id
          task-ticket-id)))
