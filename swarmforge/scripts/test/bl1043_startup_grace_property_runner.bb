#!/usr/bin/env bb
;; BL-1043 property test (coder-authored, two DECLARED invariants) over
;; front_desk_supervisor_lib.bb's poll-heartbeat-stale?.
;;
;;   Invariant 1: "No supervisor declares a freshly spawned child stalled
;;   before that child has had one full startup grace in which to produce its
;;   first heartbeat - AND NO CALL SITE CAN OPT OUT OF THAT GRACE BY
;;   ACCIDENT."
;;
;;   Invariant 2: "A freshly spawned child is never judged on a heartbeat
;;   written by a process that is no longer running."
;;
;; WHAT THIS ADDS OVER BL-1035's RUNNER, which is the obvious question. That
;; one quantifies over TIMESTAMPS at a single call shape - the 5-arity, always
;; handed a real spawn time and a real grace. BL-1043 is not a defect in that
;; arithmetic; the arithmetic was already right. It is a defect in WHICH CALL
;; SHAPE a supervisor reaches for, and the shipped bug lived entirely in the
;; convenience arity BL-1035's runner never calls. So the extra quantifier
;; here is the CALL FORM itself: every property below is checked across every
;; way a caller can ask the question, and the second clause of invariant 1
;; ("by accident") is encoded as the grace-less form being UNREACHABLE rather
;; than as an assertion about its answers.
;;
;; P1 is invariant 1: inside the grace, a child that has not spoken is never
;; stalled - at EVERY call form.
;;
;; P2 is invariant 1's second clause, and it is the one that would have caught
;; the shipped defect: the defaulting call form must agree with an explicit
;; grace of the library default, at every clock value. Stated as an EQUALITY
;; rather than as "is not stalled", because the shipped bug was precisely a
;; call form that silently answered differently from the one the author
;; believed they were calling. An implementation that gave the short form some
;; other, shorter grace would pass a not-stalled check inside that shorter
;; window and still be the same class of trap.
;;
;; P3 is invariant 2, encoded as an INDISTINGUISHABILITY exactly as BL-1035's
;; P1 is: a pre-spawn heartbeat must produce the SAME verdict as no heartbeat
;; at all, at every clock value and every call form. That is the only way to
;; state "carries no information"; asserting merely "not stalled inside the
;; grace" would be invariant 1 again and would say nothing about whose
;; timestamp was read.
;;
;; P4 is the armed-ness backstop, and it is not optional: P1, P2 and P3 are
;; ALL satisfied by a predicate that returns false unconditionally, which
;; would delete the stall check entirely and reinstate BL-370's nine-hour
;; silent outage. Two invariants that only forbid false positives always need
;; a third property holding the false negatives.
;;
;; P5 is the "by accident" clause itself: the grace-less 3-arity must not
;; resolve. This is a property of the FUNCTION rather than of any generated
;; input, so it is asserted once rather than per run - a call site that
;; forgets the spawn time must fail loudly, not lose its protection quietly.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; The live failure needs a clock inside the grace AND no heartbeat this child
;; wrote - and, for the predecessor arm, a heartbeat that is both pre-spawn
;; and already older than the stall window. Drawing three timestamps
;; independently almost never lands there (the observed incident sat 2s into
;; the window with a heartbeat ~8 minutes old), so the predecessor heartbeat
;; and the clock are both DERIVED from the spawn time rather than drawn on
;; their own. Floors below assert the defect shape, the post-grace shape and
;; the boundary were each reached, per call form.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-23), each break restored,
;; counts MEASURED (seed 1043, 400 runs):
;;   - restore the grace-less 3-arity and route the
;;     defaulting form through it (the shipped defect) ... P1 40, P2 85,
;;                                                        P3 2, P5 3
;;   - default the grace to stall-ms instead of
;;     default-startup-grace-ms (the dead-code shape the
;;     old arity's third argument pretended to be) ....... P2 92, P4 50
;;   - return false unconditionally ..................... P4 176
;;   - drop the pre-spawn comparison (own-heartbeat-ms
;;     := last-heartbeat-ms) ............................ P1 85, P3 85
;; Every number is the measured count, not an estimate.
;;
;; Two of those are worth reading twice. The FIRST break - the shipped defect
;; itself - is caught 85 times by P2 and only 2 by P3, which is the whole
;; argument for P2 existing: the timestamp arithmetic BL-1035 fixed is barely
;; disturbed by it, because the bug was never in the arithmetic. And the
;; SECOND break trips P4 as well as P2, because a grace defaulted to the
;; 120000ms stall window leaves a child unstalled through the 30000ms between
;; the real grace ending and that window closing - a longer grace than anyone
;; asked for is a hole in the guard, not a harmless generosity.

(ns bl1043-startup-grace-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "front_desk_supervisor_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {:defect-shape 0 :inside-grace 0 :past-grace 0 :at-boundary 0
                     :own-heartbeat 0 :no-heartbeat-at-all 0
                     :form-defaulted 0 :form-explicit 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))

;; The high-bits LCG draw caps a raw value at 32767 regardless of the range
;; asked for (BL-1035's runner lost a reach floor to exactly this), so every
;; offset below is SCALED explicitly rather than requested as a wide range.
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])
(def ^:private raw-max 32768)

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; The onboarder's live window, deliberately DIFFERENT from the grace. The
;; retired arity passed stall-ms into the grace slot, so a fixture where the
;; two are equal cannot tell a real default from that dead code - the whole
;; defect hides in the gap between these two numbers.
(def stall-ms 120000)
(def grace-ms front-desk-supervisor-lib/default-startup-grace-ms)

;; Every way a caller can ask. `:defaulted` is the form the two defective
;; supervisors now use and the one the shipped bug lived in.
(def call-forms
  {:defaulted (fn [hb now started-at]
                (front-desk-supervisor-lib/poll-heartbeat-stale? hb now stall-ms started-at))
   :explicit  (fn [hb now started-at]
                (front-desk-supervisor-lib/poll-heartbeat-stale? hb now stall-ms started-at grace-ms))})

;; ── P5 (invariant 1, "by accident"): the grace-less form is UNREACHABLE ───
;; Asserted once: it is a fact about the function, not about any input. A
;; caller that omits the spawn time must fail loudly rather than silently
;; inherit the no-grace behaviour that was this defect.
(let [outcome (try (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 502000 stall-ms)
                   :resolved
                   (catch Exception e
                     (if (re-find #"with 3 arguments" (str (.getMessage e))) :arity-error :other)))]
  (when (not= :arity-error outcome)
    (swap! failures conj
           (str "FAIL P5 (invariant 1: no call site can opt out of the grace by accident)\n  "
                "the grace-less 3-arity " (name outcome)
                " - a call site that forgets the spawn time must fail loudly, not lose its grace"))))

;; A nil spawn time under the DEFAULTING form is the other accidental door -
;; (:started-at-ms entry) reads nil on an entry that has not started, and the
;; supervisors compute this eagerly every tick. It must never be the old
;; immediate stall.
(doseq [[hb label] [[nil "no heartbeat"] [1000 "a long-stale heartbeat"]]]
  (let [v ((:defaulted call-forms) hb 999999 nil)]
    (when v
      (swap! failures conj
             (str "FAIL P5 (invariant 1: a nil spawn time is not an accidental opt-out)\n  "
                  "with " label " and no spawn time the defaulting form answered stale"
                  " - that is the immediate stall this ticket removes")))))

(loop [i 0 s 1043]
  (when (< i runs)
    (let [[spawn-off s1] (gen-int s 1000000)
          started-at (+ 500000 spawn-off)
          ;; DERIVED from the spawn time, never drawn independently: a
          ;; predecessor heartbeat is by definition strictly before it, and
          ;; scaled to reach ~0-17 minutes so it spans the ~8-minute stale
          ;; heartbeat the live incident actually carried.
          [pre-raw s2] (gen-int s1 raw-max)
          predecessor-hb (- started-at (* 32 pre-raw) 1)
          ;; The clock is derived too, so "inside the grace" is reachable by
          ;; construction rather than by luck.
          [rel s3] (gen-int s2 3)                 ; 0 inside, 1 exactly at, 2 past
          [inside-raw s4] (gen-int s3 raw-max)
          inside (mod (* 3 inside-raw) grace-ms)
          [past-raw s5] (gen-int s4 raw-max)
          now (case rel
                0 (+ started-at inside)                       ; strictly inside
                1 (+ started-at grace-ms)                     ; the boundary
                2 (+ started-at grace-ms (* 16 past-raw) 1))  ; past
          ;; Sometimes the child speaks for itself.
          [own? s6] (gen-int s5 3)
          [own-raw s7] (gen-int s6 raw-max)
          own-hb (when (and (zero? own?) (> now started-at))
                   (+ started-at (mod own-raw (max 1 (- now started-at)))))
          heartbeat (or own-hb predecessor-hb)
          [form-pick s8] (gen-int s7 2)
          form-key (if (zero? form-pick) :defaulted :explicit)
          ask (get call-forms form-key)
          verdict (ask heartbeat now started-at)
          input {:heartbeat heartbeat :now now :started-at started-at
                 :own? (some? own-hb) :form form-key}]

      (swap! coverage update (case rel 0 :inside-grace 1 :at-boundary 2 :past-grace) inc)
      (swap! coverage update (if (= form-key :defaulted) :form-defaulted :form-explicit) inc)
      (when own-hb (swap! coverage update :own-heartbeat inc))
      (when (and (nil? own-hb) (= rel 0) (>= (- now predecessor-hb) stall-ms))
        (swap! coverage update :defect-shape inc))

      ;; ── P1 (invariant 1): never stalled before one full grace has passed,
      ;; at EVERY call form.
      (when (< (- now started-at) grace-ms)
        (when (and (nil? own-hb) verdict)
          (report! "P1 (invariant 1: no child is declared stalled inside its startup grace)" s input
                   "declared stalled with the grace still running"))
        (when (and own-hb (< (- now own-hb) stall-ms) verdict)
          (report! "P1 (invariant 1: a child that spoke inside its grace is not stalled)" s input
                   "declared stalled despite its own fresh heartbeat")))

      ;; ── P2 (invariant 1, "by accident"): the form that names no grace must
      ;; answer IDENTICALLY to one that names the library default. An
      ;; implementation that quietly gave the short form a different window
      ;; would still be a call site getting protection it did not ask for and
      ;; cannot see.
      (let [defaulted ((:defaulted call-forms) heartbeat now started-at)
            explicit ((:explicit call-forms) heartbeat now started-at)]
        (when (not= defaulted explicit)
          (report! "P2 (invariant 1: naming no grace is the same as naming the default one)" s input
                   (str "defaulted form: " defaulted ", explicit default grace: " explicit))))

      ;; ── P3 (invariant 2): a pre-spawn heartbeat carries NO information -
      ;; the verdict with the predecessor's timestamp equals the verdict with
      ;; no heartbeat at all, at every clock value and every call form.
      (when (nil? own-hb)
        (let [as-if-absent (ask nil now started-at)]
          (when (not= verdict as-if-absent)
            (report! "P3 (invariant 2: a dead process's heartbeat is indistinguishable from none)" s input
                     (str "with predecessor heartbeat: " verdict ", with none: " as-if-absent)))))

      ;; ── P4: the guard is still ARMED. Without this, `false` everywhere
      ;; satisfies P1, P2 and P3 and silently deletes BL-370's protection.
      (when (and (nil? own-hb) (>= (- now started-at) grace-ms))
        (when-not verdict
          (report! "P4 (the grace expires - a child that never heartbeats is still caught)" s input
                   "not stalled after a full grace with no heartbeat of its own"))
        (swap! coverage update :no-heartbeat-at-all inc))

      (recur (inc i) s8))))

(doseq [[k floor] {:defect-shape 50 :inside-grace 100 :past-grace 100 :at-boundary 80
                   :own-heartbeat 80 :no-heartbeat-at-all 100
                   :form-defaulted 150 :form-explicit 150}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1043 startup-grace properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
