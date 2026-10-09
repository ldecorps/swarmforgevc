#!/usr/bin/env bb
;; BL-1004: a stage queue hands a REWORK only to a seat that can work it
;; safely. BL-983 made seat selection a pure race over the stage's one
;; queue - right for fresh work, wrong for a rework: a bounce claimed by a
;; seat that never built the parcel is authored on a tree without the work
;; it reworks (measured on BL-994). The decision here is pure; the IO
;; wiring lives in ready_for_next_task.bb's dequeue path, INSIDE the
;; mailbox/claim layer, so seat identity never escapes it (BL-983's own
;; invariant, preserved).
;;
;; Declared invariants (ticket BL-1004), encoded in
;; test/seat_affinity_lib_test_runner.bb and generatively in
;; test/bl1004_seat_affinity_property_runner.bb:
;;   1 A deferral is always bounded: a :defer requires a KNOWN age below
;;     the deadline. Age at/past the deadline claims; an age no header
;;     parses claims too - a parcel whose clock cannot be read must never
;;     wait on this decision forever. (Deliberately the OPPOSITE polarity
;;     from mono-router-lib/note-aged?'s fail-closed nil: there, failing
;;     closed means "don't rotate the resident on a guess"; here, failing
;;     closed (defer) would strand the parcel unboundedly.)
;;   2 Seat identity never escapes the mailbox layer: the diagnostic lines
;;     receive the sibling seat ids and must never render one.
;;   3 A single-seat stage is behaviourally identical: with no sibling
;;     tasks the decision is :claim for every input, so the deferral path
;;     is unreachable exactly when a stage has one seat.

(ns seat-affinity-lib
  (:require [clojure.string :as str]))

(def default-cross-seat-claim-deadline-ms
  "How long a git_handoff whose task a SIBLING seat has worked waits in the
   stage queue for that seat before any seat may claim it. Thirty minutes:
   long enough for a busy sibling to finish a turn and poll, short enough
   that a seat that never returns cannot strand a rework for a shift.
   swarmforge.conf documents this default as a COMMENTED line rather than
   duplicating the literal value, so the two cannot drift apart."
  1800000)

(defn parse-cross-seat-claim-deadline-ms
  "Pure: `config cross_seat_claim_deadline_ms <ms>` from conf text. Honors
   a POSITIVE integer only - absent, malformed, zero, and negative all
   degrade to the default (a zero/negative deadline would disable deferral
   entirely and silently reinstate the BL-994 hazard)."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                   (filter #(str/starts-with? % "config cross_seat_claim_deadline_ms"))
                   first
                   (re-find #"-?\d+")
                   parse-long)]
    (if (and n (pos? n)) n default-cross-seat-claim-deadline-ms)))

(defn parse-instant-ms
  "Pure: an ISO-8601 instant string to epoch millis, or nil when absent,
   blank, or unparseable - never throws."
  [s]
  (try
    (some-> s str str/trim not-empty java.time.Instant/parse .toEpochMilli)
    (catch Exception _ nil)))

;; The types a rework deferral applies to: a git_handoff, and since BL-1843
;; a note naming a ticket (`Work BL-...` / `BL-... still todo`), deferred
;; exactly as a git_handoff for that ticket would be. One definition for
;; both the claim decision and the stall sweeps' hold (hotfix 2026-10-09,
;; coder note 000199), which disagreed until then. BL-1655's reclaim branch
;; stays type-agnostic in both.
(def rework-deferrable-types #{"git_handoff" "note"})

(defn rework-claim-decision
  "Pure: may THIS seat claim this stage-queue candidate now?
     {:action :claim}                          - not subject to deferral
     {:action :defer :task t}                  - a sibling seat worked t,
                                                 or held a claim this item
                                                 was reclaimed from; leave
                                                 it in the queue
     {:action :claim-cross-seat :task t}       - as above but the deadline
                                                 passed (or no age is
                                                 readable): claim, and say
                                                 so out loud
   Two independent deferral candidates, either sufficient on its own:
     - a git_handoff OR a note naming a ticket a SIBLING seat has worked
       (self-affinity wins: a seat that worked the task itself holds the
       history and claims at once; BL-1843: a note that names a ticket in
       either wording - `Work BL-…` or `BL-… still todo` - is deferred
       exactly as a git_handoff for that ticket would be);
     - BL-1655: ANY type reclaimed (held-by-seat non-blank) from a seat
       other than my-seat (self-affinity wins here too: the seat that held
       the claim - whose worktree holds the half-built work - claims its
       own reclaim at once, whatever the task or sibling-tasks say).
   Age source is the first PARSEABLE of enqueued_at then created_at
   (enqueued_at answers 'how long has this sat in THIS mailbox' - a
   redelivered parcel is fresh here even when created long ago, and
   reclaim-file! stamps exactly that fresh value at the reclaim moment;
   same ordering as mono-router-lib/note-aged?). File mtime is never
   consulted (worktree hot-sync touches files)."
  [{:keys [type task sibling-tasks my-tasks enqueued-at created-at now-ms deadline-ms
           held-by-seat my-seat]}]
  (let [reclaimed-elsewhere? (and (not (str/blank? (str held-by-seat)))
                                   (not= (str held-by-seat) (str my-seat)))
        rework-candidate? (and (contains? rework-deferrable-types type)
                                (not (str/blank? (str task)))
                                (not (contains? (set my-tasks) task))
                                (contains? (set sibling-tasks) task))]
    (if (or reclaimed-elsewhere? rework-candidate?)
      (let [age-source (or (parse-instant-ms enqueued-at) (parse-instant-ms created-at))]
        (if (and age-source (< (- now-ms age-source) deadline-ms))
          {:action :defer :task task}
          {:action :claim-cross-seat :task task}))
      {:action :claim})))

(defn deferral-hold?
  "Pure: is this scanned stage-queue parcel inside its DESIGNED cross-seat
   deferral wait window - i.e. would at least one seat of its stage defer it
   right now? The stall sweeps (flow_watchdog_lib.bb, chase_sweep_lib.bb)
   consult this the same way they consult the ambulance hold, so a parcel
   waiting for its affine seat never trips a false stuck-parcel alarm
   (architect bounce 2026-08-21: the 30-minute deferral window is twice the
   watchdog's 15-minute default warn).

   seat-worked-task-sets is one worked-task set PER SEAT of the parcel's
   stage - per-seat, not their union, because a deferral needs BOTH a seat
   that worked the task and a seat that did not: when every seat worked it
   (whichever polls self-claims) or none did (fresh work), no deferral can
   occur and a sitting parcel is a real stall. Single-seat stages and an
   empty roles.tsv therefore never hold (invariant 3, structurally). Age
   follows rework-claim-decision exactly - enqueued_at then created_at,
   never mtime - and every release is fail-OPEN: unreadable age and at/past
   deadline both un-hold, mirroring the claim path's own :claim-cross-seat
   polarity (invariant 1: nothing waits, and nothing is muted, forever).
   BL-1655: also holds for ANY type reclaimed (held-by-seat non-blank) on a
   stage with more than one seat - the sweep's stall alarm is exactly as
   false there as it is for a sibling rework, and per invariant 3's own
   'a stage with one seat never defers', a single-seat stage's
   seat-worked-task-sets has exactly one entry so this branch is
   structurally false there too, no extra check needed.

   Hotfix 2026-10-09 (coder note 000199): the rework branch reads
   rework-deferrable-types, the same set rework-claim-decision reads. BL-1843
   widened the claim decision to notes naming a ticket while this branch
   still required `git_handoff`, so a note the claim path was deferring
   stayed unheld here and the stall sweeps could alarm on it
   (bl1004_seat_affinity_property_runner.bb's hold <=> some-seat-defers
   sweep went red).

   Returns a bare boolean - no seat identity escapes (invariant 2)."
  [{:keys [type task seat-worked-task-sets enqueued-at created-at now-ms deadline-ms held-by-seat]}]
  (boolean
   (and (or (and (not (str/blank? (str held-by-seat)))
                 (> (count seat-worked-task-sets) 1))
            (and (contains? rework-deferrable-types type)
                 (not (str/blank? (str task)))
                 (some #(contains? % task) seat-worked-task-sets)
                 (some #(not (contains? % task)) seat-worked-task-sets)))
        (let [age-source (or (parse-instant-ms enqueued-at) (parse-instant-ms created-at))]
          (and age-source (< (- now-ms age-source) deadline-ms))))))

;; ── diagnostic lines ──────────────────────────────────────────────────────
;; Both render fns RECEIVE the sibling seat ids (the wiring has them in
;; scope, and naming "the seat that worked it" is the obvious temptation)
;; and must never render one - invariant 2's executable teeth. The property
;; runner sweeps these over adversarial seat ids.

(defn deferral-line
  "The out-loud diagnostic for a deferred sibling rework. Printed by the
   claim path beside the other SKIPPED lines; the parcel stays untouched in
   the stage queue, exactly like an ambulance hold."
  [{:keys [basename task]}]
  (str "DEFERRED sibling-rework: " basename " (task " task
       ") was worked by another seat of this stage; leaving it in the stage"
       " queue for that seat until the cross-seat deadline."))

(defn cross-seat-claim-line
  "The out-loud diagnostic for a cross-seat claim past the deadline: the
   claim goes ahead, and the seat is told it did not build this parcel so
   it merges the parcel commit FIRST (Forwarded Commits Carry Their
   Lineage), then works."
  [{:keys [basename task]}]
  (str "CROSS_SEAT_CLAIM: this seat did not build " basename " (task " task
       "); the cross-seat deadline passed, so it claims the rework - merge"
       " the parcel commit FIRST, then work."))

;; BL-1655: the reclaim-flavored twins of the two lines above - same
;; invariant 2 (never render a seat id), different wording, since "was
;; worked by another seat" is the rework story, not the reclaim one, and a
;; reclaimed NOTE has no task to name.

(defn reclaimed-deferral-line
  "The out-loud diagnostic for a reclaimed item left to the seat that held
   it: printed by the claim path beside the other SKIPPED lines; the
   parcel stays untouched in the stage queue, exactly like an ambulance
   hold."
  [{:keys [basename]}]
  (str "DEFERRED reclaimed-claim: " basename
       " was reclaimed from another seat of this stage at relaunch;"
       " leaving it in the stage queue for that seat until the cross-seat"
       " deadline."))

(defn reclaimed-cross-seat-claim-line
  "The out-loud diagnostic for a cross-seat claim of a reclaimed item past
   the deadline: the seat that held it never came back for it, so any
   seat of the stage may pick it up - out loud, same polarity as
   cross-seat-claim-line."
  [{:keys [basename]}]
  (str "CROSS_SEAT_CLAIM: " basename
       " was reclaimed from another seat of this stage; the cross-seat"
       " deadline passed, so this seat claims it - merge the parcel commit"
       " FIRST if it is a git_handoff, then work."))
