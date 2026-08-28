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

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

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

(defn findings-for-git-handoff
  "The one impure entry point. Returns {:findings [{:path :ticket-id}]} on
   a clean read (possibly empty), or {:warning \"...\"} when origin/main or
   the diff could not be read - never both, mirroring
   parcel_rollback_guard_lib.bb's own contract exactly."
  [{:keys [root task-name commit]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
        unreadable-warning (delay {:warning (str "task-scope check could not run for " task-name
                                                  " (origin/main or the diff for " commit
                                                  " unreadable) - send allowed, unverified (BL-1192)")})]
    (if-not task-ticket-id
      {:findings []}
      (let [ref-check (git! root "rev-parse" "-q" "--verify" "origin/main")]
        (if-not (zero? (:exit ref-check))
          @unreadable-warning
          ;; Scoped to the cited commit's OWN first-parent diff only - never
          ;; a deeper origin/main...commit range. A branch legitimately
          ;; accumulates many prior, already-reviewed tickets' commits while
          ;; origin/main lags behind (QA merge-up timing, not entanglement);
          ;; a range that spans those ancestors flags normal pipeline lag as
          ;; a foreign-scope violation. Mirrors BL-953's own precedent
          ;; (task_commit_coherence_gate_lib.bb) for exactly this shape.
          (let [diff (git! root "diff-tree" "--no-commit-id" "--name-only" "-r" "--first-parent" commit)]
            (if-not (zero? (:exit diff))
              @unreadable-warning
              (let [changed-paths (remove str/blank? (str/split-lines (:out diff)))]
                {:findings (foreign-scope-findings task-ticket-id changed-paths)}))))))))

(defn blocked? [{:keys [findings]}]
  (boolean (seq findings)))

(defn refusal-message
  [{:keys [task-name findings]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
        ticket-ids (distinct (map :ticket-id findings))
        paths (map :path findings)]
    (format (str "Cannot send git_handoff for %s: the cited commit's diff vs origin/main "
                 "carries %s (%s) belonging to %s, not to %s - the tip is entangled with "
                 "another ticket's work (BL-1192/BL-506). Rebuild or cherry-pick a tip-pure "
                 "commit for %s and re-send.")
          task-name
          (if (= 1 (count paths)) "a path" (format "%d paths" (count paths)))
          (str/join ", " paths)
          (str/join "," ticket-ids)
          task-ticket-id
          task-ticket-id)))
