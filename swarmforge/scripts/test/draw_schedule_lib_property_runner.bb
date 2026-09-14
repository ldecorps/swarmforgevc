#!/usr/bin/env bb
;; BL-1559: PROPERTY test over draw_schedule.bb, covering the ticket's
;; declared invariant (coder-authored first, per BL-654):
;;
;;   P1 floor-by-construction - for every runs >= 9 and every seed, the
;;      schedule seat-schedule returns holds AT LEAST six :n-seats 2
;;      plans, at least three :n-seats 3 plans, and at least four plans
;;      with :n-parcels >= :n-seats (all-busy) - on EVERY draw, never
;;      merely on most draws (a uniform draw the floor only hopes to
;;      cover is exactly the defect this ticket fixes; BL-1555's
;;      invariant, reused word-for-word here). Also checks the schedule's
;;      length and every plan's :n-seats/:n-parcels ranges.
;;
;; NOTE on toolchain: same precedent as ambulance_lib_property_runner.bb -
;; BL-654's "*.property.test.js" home is a TypeScript convention with no
;; Babashka equivalent; this follows the hand-rolled seeded-generator
;; convention this repo already established for .bb libs
;; (expedite_lib_property_runner.bb, BL-567 architect pass).

(ns draw-schedule-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "lib" "draw_schedule.bb")))

(def runs-per-check (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (identical LCG shape to expedite_lib_property_runner.bb / ambulance_lib_property_runner.bb) ──
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def floors {:two-seat 6 :three-seat 3 :all-busy 4})

(defn- coverage [schedule]
  {:two-seat (count (filter #(= 2 (:n-seats %)) schedule))
   :three-seat (count (filter #(= 3 (:n-seats %)) schedule))
   :all-busy (count (filter #(>= (:n-parcels %) (:n-seats %)) schedule))})

(defn- check-draw
  "Returns nil when every check passes for this (runs, seed), else a
   failure message string."
  [runs seed]
  (let [rng (java.util.Random. (long seed))
        schedule (draw-schedule-lib/seat-schedule runs rng)
        cov (coverage schedule)
        misses (for [[k floor] floors :when (< (get cov k) floor)] [k (get cov k) floor])]
    (cond
      (not= runs (count schedule))
      (str "schedule length " (count schedule) " != runs " runs)

      (seq misses)
      (str "floor(s) missed by construction: " (pr-str misses) " coverage=" (pr-str cov))

      (some #(not (contains? #{2 3} (:n-seats %))) schedule)
      (str "plan with n-seats outside {2,3}: " (pr-str schedule))

      (some #(or (< (:n-parcels %) 1) (> (:n-parcels %) (inc (:n-seats %)))) schedule)
      (str "plan with n-parcels outside 1..n-seats+1: " (pr-str schedule))

      :else nil)))

;; runs is drawn from 9..48 (the runner's default is 16; PROPERTY_RUNS
;; overrides it to as low as 9, the quota floor - the boundary this
;; invariant is FIRM about).
(loop [i 0 s 42]
  (when (< i runs-per-check)
    (let [[runs-offset s1] (gen-int s 40) ; 9..48
          runs (+ 9 runs-offset)
          [seed-lo s2] (gen-int s1 1000000)
          seed (+ (* i 1000003) seed-lo)
          msg (check-draw runs seed)]
      (when msg (report! "P1 floor-by-construction" seed {:runs runs :seed seed} msg))
      (recur (inc i) s2))))

(println (str "draw_schedule_lib properties: " runs-per-check " draws, runs in 9..48, each checked for floor-by-construction"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
