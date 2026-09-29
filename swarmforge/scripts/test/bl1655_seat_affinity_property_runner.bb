#!/usr/bin/env bb
;; BL-1655 declared invariants, coder-first (BL-654). Generative sweep over
;; the PURE claim decision's new held-by-seat dimension (seat_affinity_lib.bb)
;; - the same rework-claim-decision/deferral-hold? BL-1004's own property
;; runner already covers for the sibling-rework dimension, extended here for
;; the reclaim dimension without touching that file's own coverage. The
;; end-to-end wiring through the real orphan_claim_sweep_lib.bb,
;; ready_for_next_task.bb and handoffd.bb --sweep-once is the BL-1655
;; acceptance feature (6 scenarios).
;;
;;   Invariant 1: between the sweep's re-delivery and the cross-seat
;;     deadline, a reclaimed item is claimable by exactly the seat that
;;     held it (self-affinity claims AT ANY AGE, even past the deadline);
;;     every sibling seat's poll leaves it in place, whatever the item's
;;     type (git_handoff as much as a bare note).
;;   Invariant 2: every deferral is fail-open - a passed deadline or an
;;     unreadable age releases the item to any seat, nothing waits forever
;;     - and a stage with one seat (deferral-hold?'s seat-worked-task-sets
;;     of length 1) never defers, whatever held_by_seat says.
;;
;; Generator reach: draws are CONSTRUCTED per shape (the sibling seat is
;; derived by excluding held-by from the seat pool, never drawn
;; independently and hoped to differ), never hoped for - the floors below
;; are absolute.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "seat_affinity_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def seed (or (some-> (System/getenv "PROPERTY_SEED") parse-long) (System/nanoTime)))
(def rng (java.util.Random. seed))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth (vec xs) (rand-int* (count xs))))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))

(def seat-pool ["coder" "coder@2" "documenter" "specifier" "hardener@3"])
(def type-pool ["git_handoff" "note" "awake" "rule_proposal"])

(defn iso [ms] (str (java.time.Instant/ofEpochMilli ms)))

;; ── invariant 1 + 2 (rework-claim-decision's held-by-seat dimension) ─────
(def claim-coverage (atom {:holder-below 0 :holder-at-or-past 0 :sibling-defer 0
                           :sibling-cross-aged 0 :sibling-cross-unreadable 0 :absent 0}))

(def claim-shapes
  [:holder-claims-below :holder-claims-at-or-past
   :sibling-defers :sibling-cross-seat-aged :sibling-cross-seat-unreadable
   :absent-not-reclaimed])

(defn draw-claim []
  (let [deadline-ms (+ 60000 (rand-int* 3600000))
        now-ms (+ 1700000000000 (rand-int* 100000000))
        type (rand-nth* type-pool)
        held-by (rand-nth* seat-pool)
        shape (rand-nth* claim-shapes)
        ;; a sibling's own seat is DERIVED by excluding held-by from the
        ;; pool - reach by construction, never an independent draw hoping
        ;; to land on a different value.
        sibling-seat (rand-nth* (remove #{held-by} seat-pool))
        age-below (rand-int* deadline-ms)
        age-at-or-past (+ deadline-ms (rand-int* deadline-ms))
        base {:type type :task nil :sibling-tasks #{} :my-tasks #{}
              :now-ms now-ms :deadline-ms deadline-ms}]
    {:shape shape
     :input (case shape
              :holder-claims-below
              (assoc base :held-by-seat held-by :my-seat held-by
                     (rand-nth* [:enqueued-at :created-at]) (iso (- now-ms age-below)))
              :holder-claims-at-or-past
              ;; self-affinity wins at ANY age, even past the deadline.
              (assoc base :held-by-seat held-by :my-seat held-by
                     (rand-nth* [:enqueued-at :created-at]) (iso (- now-ms age-at-or-past)))
              :sibling-defers
              (assoc base :held-by-seat held-by :my-seat sibling-seat
                     (rand-nth* [:enqueued-at :created-at]) (iso (- now-ms age-below)))
              :sibling-cross-seat-aged
              (assoc base :held-by-seat held-by :my-seat sibling-seat
                     (rand-nth* [:enqueued-at :created-at]) (iso (- now-ms age-at-or-past)))
              :sibling-cross-seat-unreadable
              (assoc base :held-by-seat held-by :my-seat sibling-seat
                     :enqueued-at (rand-nth* [nil "" "not-a-time" "2026-13-99T99:99:99Z"])
                     :created-at (rand-nth* [nil "" "soon"]))
              ;; never reclaimed at all (held-by-seat absent): falls
              ;; through to the pre-existing rework logic unaffected -
              ;; empty sibling-tasks and no task identity means :claim.
              :absent-not-reclaimed
              (assoc base :held-by-seat nil :my-seat (rand-nth* seat-pool)
                     (rand-nth* [:enqueued-at :created-at]) (iso (- now-ms age-below))))}))

(dotimes [i runs]
  (let [{:keys [shape input]} (draw-claim)
        decision (seat-affinity-lib/rework-claim-decision input)]
    ;; invariant 2's own no-seat-id half, for the TWO NEW diagnostic lines
    ;; this ticket adds - the same property BL-1004's own runner already
    ;; holds its own pair to (its own check is untouched; this is a
    ;; different pair of functions). A GENERIC basename, unrelated to
    ;; seat-pool's own values (same posture as BL-1004's own check) - these
    ;; two renderers take no seat parameter at all, so nothing here could
    ;; leak one except an accidental basename coincidence.
    (let [render-in {:basename (str "10_x_from_coordinator_to_someone_" i ".handoff")}]
      (doseq [line [(seat-affinity-lib/reclaimed-deferral-line render-in)
                    (seat-affinity-lib/reclaimed-cross-seat-claim-line render-in)]]
        (doseq [seat seat-pool]
          (when (str/includes? line seat)
            (fail! (str "draw " i ": seat id " seat " leaked into a reclaim diagnostic line: " line))))))
    (case shape
      :holder-claims-below
      (do (when (not= {:action :claim} decision)
            (fail! (str "draw " i ": the holder did not claim its own fresh reclaim: " (pr-str decision) " for " (pr-str input))))
          (swap! claim-coverage update :holder-below inc))

      :holder-claims-at-or-past
      (do (when (not= {:action :claim} decision)
            (fail! (str "draw " i ": self-affinity did not win past the deadline: " (pr-str decision) " for " (pr-str input))))
          (swap! claim-coverage update :holder-at-or-past inc))

      :sibling-defers
      (do (when (not= :defer (:action decision))
            (fail! (str "draw " i ": a sibling did not defer a fresh reclaim: " (pr-str decision) " for " (pr-str input))))
          (swap! claim-coverage update :sibling-defer inc))

      :sibling-cross-seat-aged
      (do (when (not= :claim-cross-seat (:action decision))
            (fail! (str "draw " i ": a sibling did not release a past-deadline reclaim: " (pr-str decision) " for " (pr-str input))))
          (swap! claim-coverage update :sibling-cross-aged inc))

      :sibling-cross-seat-unreadable
      (do (when (not= :claim-cross-seat (:action decision))
            (fail! (str "draw " i ": an unreadable-age reclaim was not released: " (pr-str decision) " for " (pr-str input))))
          (swap! claim-coverage update :sibling-cross-unreadable inc))

      :absent-not-reclaimed
      (do (when (not= {:action :claim} decision)
            (fail! (str "draw " i ": a never-reclaimed item was affected by the reclaim dimension: " (pr-str decision) " for " (pr-str input))))
          (swap! claim-coverage update :absent inc)))))

(doseq [[k floor] {:holder-below 15 :holder-at-or-past 15 :sibling-defer 15
                   :sibling-cross-aged 15 :sibling-cross-unreadable 15 :absent 15}]
  (when (< (get @claim-coverage k) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @claim-coverage k)
                " of " runs " (floor " floor ")"))))

;; ── invariant 2's other half (deferral-hold?'s held-by-seat dimension) ───
(def hold-coverage (atom {:multi-below 0 :multi-at-or-past 0 :multi-unreadable 0
                          :single-seat 0 :absent 0}))

(def hold-shapes
  [:multi-seat-held-below :multi-seat-held-at-or-past
   :multi-seat-held-unreadable :single-seat-held :no-hold-absent])

(defn draw-hold []
  (let [deadline-ms (+ 60000 (rand-int* 3600000))
        now-ms (+ 1700000000000 (rand-int* 100000000))
        type (rand-nth* type-pool)
        shape (rand-nth* hold-shapes)
        seat-count (if (= shape :single-seat-held) 1 (+ 2 (rand-int* 3)))
        sets (vec (repeatedly seat-count (fn [] (set (take (rand-int* 2) ["x" "y" "z"])))))
        held-by (if (= shape :no-hold-absent) nil (rand-nth* seat-pool))
        age-below (rand-int* deadline-ms)
        age-at-or-past (+ deadline-ms (rand-int* deadline-ms))
        enqueued-at (case shape
                      :multi-seat-held-unreadable (rand-nth* [nil "" "not-a-time"])
                      :multi-seat-held-at-or-past (iso (- now-ms age-at-or-past))
                      (iso (- now-ms age-below)))]
    {:shape shape
     :input {:type type :task nil :seat-worked-task-sets sets
             :enqueued-at enqueued-at :created-at nil
             :now-ms now-ms :deadline-ms deadline-ms
             :held-by-seat held-by}}))

(dotimes [i runs]
  (let [{:keys [shape input]} (draw-hold)
        hold (seat-affinity-lib/deferral-hold? input)]
    (when-not (boolean? hold)
      (fail! (str "hold draw " i ": hold is not a bare boolean: " (pr-str hold))))
    (case shape
      :multi-seat-held-below
      (do (when-not hold (fail! (str "hold draw " i ": a fresh multi-seat reclaim was not held: " (pr-str input))))
          (swap! hold-coverage update :multi-below inc))
      :multi-seat-held-at-or-past
      (do (when hold (fail! (str "hold draw " i ": a past-deadline reclaim was still held: " (pr-str input))))
          (swap! hold-coverage update :multi-at-or-past inc))
      :multi-seat-held-unreadable
      (do (when hold (fail! (str "hold draw " i ": an unreadable-age reclaim was still held: " (pr-str input))))
          (swap! hold-coverage update :multi-unreadable inc))
      :single-seat-held
      (do (when hold (fail! (str "hold draw " i ": a single-seat stage held a reclaim (invariant 2's 'never defers'): " (pr-str input))))
          (swap! hold-coverage update :single-seat inc))
      :no-hold-absent
      (do (when hold (fail! (str "hold draw " i ": a never-reclaimed item was held by the reclaim dimension: " (pr-str input))))
          (swap! hold-coverage update :absent inc)))))

(doseq [[k floor] {:multi-below 15 :multi-at-or-past 15 :multi-unreadable 15
                   :single-seat 15 :absent 15}]
  (when (< (get @hold-coverage k) floor)
    (fail! (str "hold generator coverage: " (name k) " reached only " (get @hold-coverage k)
                " of " runs " (floor " floor ")"))))

(println (str "  seed " seed " runs " runs " claim-coverage " (pr-str @claim-coverage)
              " hold-coverage " (pr-str @hold-coverage)))
(if (empty? @failures)
  (do (println (str "bl1655 seat-affinity held-by-seat properties: " runs " draws over the pure claim decision"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
