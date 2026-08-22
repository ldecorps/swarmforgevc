#!/usr/bin/env bb
;; BL-1035 property test (coder-authored, two DECLARED invariants) over
;; front_desk_supervisor_lib.bb's poll-heartbeat-stale? - the pure predicate
;; six supervisors share.
;;
;;   Invariant 1: "A freshly spawned child is never judged on a heartbeat
;;   written by a process that is no longer running."
;;
;;   Invariant 2: "No path declares a child stalled before that child has had
;;   one full startup grace in which to produce its first heartbeat."
;;
;; P1 encodes invariant 1 as an INDISTINGUISHABILITY, which is the only way to
;; state "carries no information": a pre-spawn heartbeat must produce the
;; SAME verdict as no heartbeat at all, at every clock value. Asserting merely
;; that the child is not stalled inside the grace would be invariant 2 again
;; and would say nothing about the predecessor's timestamp being ignored.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; The live failure needs THREE things at once - a heartbeat that is pre-spawn,
;; already older than the stall window, AND a clock still inside the startup
;; grace - which is the shape drawing three timestamps independently almost
;; never produces (the observed incident sat 2s into a 90s grace with a
;; heartbeat ~8 minutes old). So the predecessor heartbeat is DERIVED from the
;; spawn time by subtracting a generated offset, rather than drawn on its own,
;; and the clock is derived from the spawn time too. Floors below assert the
;; defect shape, the post-grace shape and the boundary were each reached.
;;
;; P3 exists because P1 and P2 are both satisfied by a predicate that returns
;; false unconditionally - which would delete the whole stall check and
;; reintroduce BL-370's nine-hour silent outage.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break restored,
;; counts MEASURED (seed 1035, 400 runs):
;;   - revert to the nil-guard (the shipped defect) ..... P1 87, P2 87
;;   - return false unconditionally .................... P3 159
;; Every number is the measured count, not an estimate. The 87 is worth
;; noting: it is exactly the :defect-shape coverage count, so the generator
;; reaches precisely the states the live bug fails in - no more, no fewer.
;;
;; The second break is why P3 exists. Returning false everywhere satisfies
;; both DECLARED invariants completely - nothing is ever judged on a dead
;; process's heartbeat, and nothing is ever stalled inside its grace - while
;; deleting the entire stall check and reinstating BL-370's nine-hour silent
;; outage. Two invariants that only forbid false positives need a third
;; property holding the false negatives.

(ns bl1035-startup-grace-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "front_desk_supervisor_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {:defect-shape 0 :inside-grace 0 :past-grace 0 :at-boundary 0
                     :own-heartbeat 0 :no-heartbeat-at-all 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))

;; NOTE, because it cost a reach floor to find: this LCG draw takes the HIGH
;; bits (`quot s 65536`) because an LCG's low bits are weak, which caps the
;; raw value at 32767 no matter what `n` is asked for. Requesting a range of
;; 600000 silently yields 0..32767. The first version of this runner drew both
;; the pre-spawn offset and the in-grace clock that way, so their sum could
;; never reach the 90000ms stall window and the DEFECT SHAPE was generated
;; zero times in 400 runs - the properties "held" against a live, reproducible
;; bug. The coverage floor is what caught it. Offsets below are therefore
;; SCALED explicitly rather than asked for as a wide range.
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])
(def ^:private raw-max 32768)

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def stall-ms 90000)
(def grace-ms 90000)

(loop [i 0 s 1035]
  (when (< i runs)
    (let [[spawn-off s1] (gen-int s 1000000)
          started-at (+ 500000 spawn-off)
          ;; DERIVED from the spawn time, never drawn independently: a
          ;; predecessor heartbeat is by definition strictly before it.
          ;; Scaled to reach ~0-17 minutes, which spans the ~8-minute stale
          ;; heartbeat the live incident actually carried.
          [pre-raw s2] (gen-int s1 raw-max)
          pre-off (* 32 pre-raw)
          predecessor-hb (- started-at pre-off 1)
          ;; The clock is derived too, so "inside the grace" is reachable by
          ;; construction rather than by luck.
          [rel s3] (gen-int s2 3)          ; 0 inside, 1 exactly at, 2 past
          ;; Scaled to span the WHOLE grace, not just its first third.
          [inside-raw s4] (gen-int s3 raw-max)
          inside (mod (* 3 inside-raw) grace-ms)
          [past-raw s5] (gen-int s4 raw-max)
          past (* 16 past-raw)
          now (case rel
                0 (+ started-at inside)              ; strictly inside
                1 (+ started-at grace-ms)            ; the boundary
                2 (+ started-at grace-ms past 1))    ; past
          ;; Sometimes the child speaks for itself.
          [own? s6] (gen-int s5 3)
          [own-raw s7] (gen-int s6 raw-max)
          own-off (mod own-raw (max 1 (- now started-at)))
          own-hb (when (and (zero? own?) (> now started-at)) (+ started-at own-off))
          heartbeat (or own-hb predecessor-hb)
          verdict (front-desk-supervisor-lib/poll-heartbeat-stale?
                    heartbeat now stall-ms started-at grace-ms)
          input {:heartbeat heartbeat :now now :started-at started-at :own? (some? own-hb)}]

      (swap! coverage update (case rel 0 :inside-grace 1 :at-boundary 2 :past-grace) inc)
      (when own-hb (swap! coverage update :own-heartbeat inc))
      (when (and (nil? own-hb) (= rel 0) (>= (- now predecessor-hb) stall-ms))
        (swap! coverage update :defect-shape inc))

      ;; ── P1 (invariant 1): a pre-spawn heartbeat carries NO information.
      ;; The verdict with the predecessor's timestamp must equal the verdict
      ;; with no heartbeat at all - at every clock value, inside the grace and
      ;; past it. This is what "never judged on it" actually means.
      (when (nil? own-hb)
        (let [as-if-absent (front-desk-supervisor-lib/poll-heartbeat-stale?
                             nil now stall-ms started-at grace-ms)]
          (when (not= verdict as-if-absent)
            (report! "P1 (invariant 1: a dead process's heartbeat is indistinguishable from none)" s input
                     (str "with predecessor heartbeat: " verdict ", with none: " as-if-absent)))))

      ;; ── P2 (invariant 2): never stalled before one full grace has passed.
      (when (< (- now started-at) grace-ms)
        (when (and (nil? own-hb) verdict)
          (report! "P2 (invariant 2: no child is declared stalled inside its startup grace)" s input
                   "declared stalled with the grace still running"))
        ;; A child that HAS spoken inside its grace is likewise not stalled -
        ;; its own heartbeat is by construction newer than the grace is long.
        (when (and own-hb (< (- now own-hb) stall-ms) verdict)
          (report! "P2 (invariant 2: a child that spoke inside its grace is not stalled)" s input
                   "declared stalled despite its own fresh heartbeat")))

      ;; ── P3: the guard is still ARMED. Without this, `false` everywhere
      ;; satisfies P1 and P2 and silently deletes BL-370's whole protection.
      (when (and (nil? own-hb) (>= (- now started-at) grace-ms))
        (when-not verdict
          (report! "P3 (the grace expires - a child that never polls is still caught)" s input
                   "not stalled after a full grace with no heartbeat of its own"))
        (swap! coverage update :no-heartbeat-at-all inc))

      (recur (inc i) s7))))

(doseq [[k floor] {:defect-shape 60 :inside-grace 100 :past-grace 100 :at-boundary 80
                   :own-heartbeat 80 :no-heartbeat-at-all 100}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1035 startup-grace properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
