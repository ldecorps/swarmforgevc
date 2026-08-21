#!/usr/bin/env bb
;; TDD runner for seat_affinity_lib.bb (BL-1004) - pure assertions, no fs/git.
;;
;; BL-1004: a stage queue hands a REWORK only to a seat that can work it
;; safely. The decision is pure over {type task sibling-tasks my-tasks
;; enqueued-at created-at now-ms deadline-ms}; the IO wiring in
;; ready_for_next_task.bb collects those inputs from the mailboxes. The
;; three declared invariants shape the table below:
;;   1 (bounded): every :defer implies a KNOWN age below the deadline -
;;     age at/past the deadline, and age UNKNOWN, both claim (a parcel with
;;     an unreadable clock must never wait forever).
;;   2 (seat identity stays in the mailbox layer): the rendered diagnostic
;;     lines take the sibling seat ids and must never leak one.
;;   3 (single-seat unchanged): empty sibling-tasks claims for EVERY input.
(ns seat-affinity-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "seat_affinity_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (assert= msg true (boolean actual)))

;; ── parse-cross-seat-claim-deadline-ms ────────────────────────────────────
(assert= "absent knob degrades to the default"
         seat-affinity-lib/default-cross-seat-claim-deadline-ms
         (seat-affinity-lib/parse-cross-seat-claim-deadline-ms "config other 5\n"))

(assert= "nil conf text degrades to the default"
         seat-affinity-lib/default-cross-seat-claim-deadline-ms
         (seat-affinity-lib/parse-cross-seat-claim-deadline-ms nil))

(assert= "a positive knob is honored"
         60000
         (seat-affinity-lib/parse-cross-seat-claim-deadline-ms
          "config cross_seat_claim_deadline_ms 60000\n"))

(assert= "zero degrades to the default (a zero deadline would disable deferral entirely)"
         seat-affinity-lib/default-cross-seat-claim-deadline-ms
         (seat-affinity-lib/parse-cross-seat-claim-deadline-ms
          "config cross_seat_claim_deadline_ms 0\n"))

(assert= "negative degrades to the default"
         seat-affinity-lib/default-cross-seat-claim-deadline-ms
         (seat-affinity-lib/parse-cross-seat-claim-deadline-ms
          "config cross_seat_claim_deadline_ms -5\n"))

(assert= "malformed degrades to the default"
         seat-affinity-lib/default-cross-seat-claim-deadline-ms
         (seat-affinity-lib/parse-cross-seat-claim-deadline-ms
          "config cross_seat_claim_deadline_ms soon\n"))

;; ── rework-claim-decision: claims that never consult the clock ────────────
(def base
  {:type "git_handoff"
   :task "BL-777"
   :sibling-tasks #{"BL-777"}
   :my-tasks #{}
   :enqueued-at "2026-08-21T00:00:00Z"
   :created-at "2026-08-20T00:00:00Z"
   ;; five minutes after enqueue, deadline thirty minutes
   :now-ms (+ 1787270400000 300000)
   :deadline-ms 1800000})

;; 2026-08-21T00:00:00Z in epoch millis, precomputed so the table reads.
(def enqueue-ms 1787270400000)
(assert= "the fixture instant parses to the precomputed epoch millis"
         enqueue-ms
         (seat-affinity-lib/parse-instant-ms "2026-08-21T00:00:00Z"))

(assert= "a note is never deferred (only a git_handoff is a rework)"
         {:action :claim}
         (seat-affinity-lib/rework-claim-decision (assoc base :type "note")))

(assert= "a git_handoff with no task claims"
         {:action :claim}
         (seat-affinity-lib/rework-claim-decision (assoc base :task nil)))

(assert= "no sibling worked the task: claim (fresh work path, unchanged)"
         {:action :claim}
         (seat-affinity-lib/rework-claim-decision (assoc base :sibling-tasks #{"BL-888"})))

(assert= "invariant 3: empty sibling-tasks claims whatever else is true"
         {:action :claim}
         (seat-affinity-lib/rework-claim-decision
          (assoc base :sibling-tasks #{} :enqueued-at nil :created-at nil)))

(assert= "the asking seat worked the task itself: claim (it holds the history)"
         {:action :claim}
         (seat-affinity-lib/rework-claim-decision (assoc base :my-tasks #{"BL-777"})))

(assert= "self-affinity wins even when a sibling also worked the task"
         {:action :claim}
         (seat-affinity-lib/rework-claim-decision
          (assoc base :my-tasks #{"BL-777"} :sibling-tasks #{"BL-777"})))

;; ── rework-claim-decision: the sibling-rework fork ────────────────────────
(assert= "sibling worked it, age below the deadline: defer"
         {:action :defer :task "BL-777"}
         (seat-affinity-lib/rework-claim-decision base))

(assert= "sibling worked it, age exactly at the deadline: cross-seat claim"
         {:action :claim-cross-seat :task "BL-777"}
         (seat-affinity-lib/rework-claim-decision
          (assoc base :now-ms (+ enqueue-ms 1800000))))

(assert= "sibling worked it, age past the deadline: cross-seat claim"
         {:action :claim-cross-seat :task "BL-777"}
         (seat-affinity-lib/rework-claim-decision
          (assoc base :now-ms (+ enqueue-ms 1800001))))

(assert= "invariant 1: an unreadable age never defers - cross-seat claim"
         {:action :claim-cross-seat :task "BL-777"}
         (seat-affinity-lib/rework-claim-decision
          (assoc base :enqueued-at "not-a-time" :created-at nil)))

(assert= "enqueued_at leads created_at (a redelivered parcel is fresh here)"
         {:action :defer :task "BL-777"}
         (seat-affinity-lib/rework-claim-decision
          ;; created_at is a day older than the deadline; enqueued_at is
          ;; five minutes ago - the parcel is fresh in THIS mailbox.
          (assoc base :now-ms (+ enqueue-ms 300000))))

(assert= "created_at is the fallback when enqueued_at does not parse"
         {:action :claim-cross-seat :task "BL-777"}
         (seat-affinity-lib/rework-claim-decision
          (assoc base :enqueued-at nil :now-ms (+ enqueue-ms 300000))))

;; ── diagnostic lines: invariant 2, seat identity never leaks ─────────────
(def render-input
  {:basename "50_x_from_hardender_to_coder.handoff"
   :task "BL-777"
   :sibling-seats ["coder@sonnet2" "coder@extra"]})

(let [line (seat-affinity-lib/deferral-line render-input)]
  (assert-true "deferral line names the parcel" (str/includes? line (:basename render-input)))
  (assert-true "deferral line names the task" (str/includes? line "BL-777"))
  (assert-true "deferral line never contains a sibling seat id"
               (not (or (str/includes? line "coder@sonnet2")
                        (str/includes? line "coder@extra")
                        (str/includes? line "@")))))

(let [line (seat-affinity-lib/cross-seat-claim-line render-input)]
  (assert-true "cross-seat line names the parcel" (str/includes? line (:basename render-input)))
  (assert-true "cross-seat line tells the seat it did not build this parcel"
               (str/includes? line "did not build"))
  (assert-true "cross-seat line never contains a sibling seat id"
               (not (or (str/includes? line "coder@sonnet2")
                        (str/includes? line "coder@extra")
                        (str/includes? line "@")))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failing"))
      (System/exit 1))
  (println "seat_affinity_lib_test_runner: all assertions passed"))
