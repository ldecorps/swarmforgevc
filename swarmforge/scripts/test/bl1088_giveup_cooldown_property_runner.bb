#!/usr/bin/env bb
;; BL-1088 property test (coder-authored, THREE declared invariants) over
;; front_desk_supervisor_lib.bb's check-one! gave-up branch - the bounded
;; restart decision all six supervisors share.
;;
;;   Invariant 1: "A declared cooldown is the delivered cooldown: a child that
;;   has reached give-up is not respawned until its configured
;;   giveup-cooldown-ms has elapsed, WHATEVER the liveness of the process
;;   recorded against it."
;;
;;   Invariant 2: "Give-up stays a TIMED state, never terminal: once the
;;   cooldown DOES elapse the child re-arms with a fresh budget. Restoring the
;;   bound must not restore BL-303's sticky give-up."
;;
;;   Invariant 3: "One contract per behaviour: no two executable assertions in
;;   the repo may demand contradictory results from check-one! for the same
;;   inputs."
;;
;; P1 states invariant 1 as an EQUIVALENCE - re-armed IF AND ONLY IF the
;; cooldown has elapsed - and quantifies over pid liveness as a free variable,
;; because "whatever the liveness" is the whole clause. Stated one-way it would
;; be satisfied by a function that never re-arms at all, which is exactly the
;; sticky give-up BL-303 removed and invariant 2 forbids.
;;
;; P2 is invariant 2, and it is stated as REACHABILITY rather than as a check
;; at one instant: for every generated entry there EXISTS a future instant at
;; which it re-arms with a fresh budget. That is what "timed, never terminal"
;; means, and it is the property a too-eager fix would break.
;;
;; P3 is invariant 3, and it is necessarily a claim about the SOURCE TREE
;; rather than about inputs: it scans every test file for an assertion
;; demanding a re-arm inside an unelapsed cooldown. Two such contracts existed
;; when this ticket was written - one in this lib's own runner, one in
;; cursor_bridge_supervisor_test_runner.bb - and the shell test asserting the
;; opposite had been red on main ever since. A property that only checked
;; behaviour could not have caught that, because both were individually
;; consistent with SOME implementation.
;;
;; P4 is the armed-ness backstop, and it is not optional: P1's "not before"
;; half and P3 are both satisfied by a child that is never respawned, and P2
;; alone by one respawned constantly. It sweeps a whole cooldown window at the
;; real 2000ms cadence and counts spawns - which is what turns "re-armed once"
;; into the hot loop the operator actually pays for. With the shipped defect
;; restored this measures 104 spawns across 449 ticks.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-23), each break restored,
;; counts MEASURED (seed 1088, 200 runs):
;;   - restore the dead-pid disjunct (the shipped defect) .... P1 93, P4 30
;;   - never re-arm (BL-303's sticky give-up) ...... P1 260, P2 400, P5 200
;;   - re-arm on every tick .................................. P1 210, P4 68
;;   - drop the kill-pid! guard on re-arm (BL-403) ........... P5 200
;; Every number is the measured count, not an estimate.
;;
;; P3 is absent from that table because no break to the LIB can trip it - it is
;; a claim about the source tree, and the only thing that trips it is
;; reinstating a contradictory assertion in a test file. That is verified
;; separately: before the two contracts were retired this scan named both, and
;; it named them again the moment a comment-stripping bug let prose through.

(ns bl1088-giveup-cooldown-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def repo-root (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*)))))))
(load-file (str (fs/path repo-root "swarmforge" "scripts" "front_desk_supervisor_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))
(def coverage (atom {:inside 0 :at-boundary 0 :past 0 :pid-alive 0 :pid-dead 0
                     :short-cooldown 0 :long-cooldown 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def gave-up-at 1000000)
(def cfg {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000 :healthy-reset-ms 300000})

(defn- check [entry now pid-alive? cooldown-ms spawns killed]
  (front-desk-supervisor-lib/check-one!
   entry now (constantly pid-alive?)
   (fn [] (swap! spawns inc) 9999)
   cfg {:giveup-cooldown-ms cooldown-ms} false
   (fn [pid] (swap! killed conj pid))))

(loop [i 0 s 1088]
  (when (< i runs)
    (let [;; The cooldown is a free variable, because a supervisor lowering its
          ;; own is the sanctioned way to shorten an outage - the fix must hold
          ;; for every configured value, not just the 900000ms default.
          [cd-raw s1] (gen-int s 30)
          cooldown-ms (* 1000 (+ 1 cd-raw))
          ;; The clock is DERIVED from the cooldown rather than drawn: a
          ;; uniform draw over "some instant" lands on the boundary
          ;; essentially never, and the boundary is where an off-by-one lives.
          [rel s2] (gen-int s1 3)
          [off-raw s3] (gen-int s2 32768)
          now (case rel
                0 (+ gave-up-at (mod (* 3 off-raw) (max 1 cooldown-ms)))  ; strictly inside
                1 (+ gave-up-at cooldown-ms)                              ; the boundary
                2 (+ gave-up-at cooldown-ms 1 (* 7 off-raw)))             ; past
          [alive s4] (gen-int s3 2)
          pid-alive? (zero? alive)
          entry {:pid 4242 :attempts 5 :status "gave-up" :crashed-at-ms 5000
                 :started-at-ms 1000 :gave-up-at-ms gave-up-at}
          spawns (atom 0)
          killed (atom [])
          {:keys [entry event]} (check entry now pid-alive? cooldown-ms spawns killed)
          elapsed? (>= (- now gave-up-at) cooldown-ms)
          input {:cooldown-ms cooldown-ms :offset (- now gave-up-at) :pid-alive? pid-alive?}]

      (swap! coverage update (case rel 0 :inside 1 :at-boundary 2 :past) inc)
      (swap! coverage update (if pid-alive? :pid-alive :pid-dead) inc)
      (swap! coverage update (if (< cooldown-ms 10000) :short-cooldown :long-cooldown) inc)

      ;; ── P1 (invariant 1): re-armed IFF elapsed, whatever the liveness.
      (when (not= elapsed? (= :re-armed event))
        (report! "P1 (invariant 1: a declared cooldown is the delivered cooldown)" s input
                 (str "cooldown " (if elapsed? "HAS" "has NOT") " elapsed but event was " event)))
      (when (not= elapsed? (pos? @spawns))
        (report! "P1 (invariant 1: no spawn before the cooldown elapses)" s input
                 (str "spawns=" @spawns " with elapsed?=" elapsed?)))
      (when (and (not elapsed?) (not= 5 (:attempts entry)))
        (report! "P1 (invariant 1: the spent budget is not reset inside the cooldown)" s input
                 (str "attempts reset to " (:attempts entry) " - the other half of the unbounded loop")))

      ;; ── P2 (invariant 2): TIMED, never terminal. Stated as reachability:
      ;; there is always a later instant at which this same entry re-arms.
      (let [sp2 (atom 0) k2 (atom [])
            later (+ gave-up-at cooldown-ms)
            r (check {:pid 4242 :attempts 5 :status "gave-up" :crashed-at-ms 5000
                      :started-at-ms 1000 :gave-up-at-ms gave-up-at}
                     later pid-alive? cooldown-ms sp2 k2)]
        (when (not= :re-armed (:event r))
          (report! "P2 (invariant 2: give-up is TIMED, never terminal)" s input
                   (str "no instant re-arms it - BL-303's sticky give-up is back; event " (:event r))))
        (when (not= 1 (:attempts (:entry r)))
          (report! "P2 (invariant 2: the re-arm brings a FRESH budget)" s input
                   (str "attempts " (:attempts (:entry r)) " after re-arm")))
        ;; ── P5 (BL-403, which this fix must not remove): whatever is recorded
        ;; against the entry is terminated BEFORE the replacement spawns - a
        ;; gave-up entry's pid can still be alive, since "stalled" is entered
        ;; from "running" without ever checking liveness.
        (when (not= [4242] @k2)
          (report! "P5 (BL-403: the recorded process is killed before the re-arm spawn)" s input
                   (str "killed " (pr-str @k2)))))

      ;; ── P4 (armed-ness): sweep a whole window at the real cadence and count
      ;; spawns. P1's "not before" half and P3 are both satisfied by a child
      ;; that is never respawned at all; this is what says the bound is a
      ;; BOUND and not a wall.
      (when (zero? rel)
        (let [sp (atom 0) k (atom [])
              tick 2000]
          (loop [e {:pid 4242 :attempts 5 :status "gave-up" :crashed-at-ms 5000
                    :started-at-ms 1000 :gave-up-at-ms gave-up-at}
                 t (+ gave-up-at tick)]
            (when (< t (+ gave-up-at cooldown-ms))
              (recur (:entry (check e t pid-alive? cooldown-ms sp k)) (+ t tick))))
          (when (pos? @sp)
            (report! "P4 (the window is bounded: no spawn anywhere inside the cooldown)" s input
                     (str @sp " spawn(s) across the window - the hot loop is back")))))

      (recur (inc i) s4))))

;; ── P3 (invariant 3): one contract per behaviour, checked over the TREE ────
;; Two executable assertions demanded opposite results from this one function
;; when the ticket was written, and each was individually consistent with some
;; implementation - so only a source-level check can catch the contradiction.
;; A file asserting a re-arm while naming a cooldown far larger than the
;; elapsed span is asserting the retired contract.
(let [test-dir (fs/path repo-root "swarmforge" "scripts" "test")
      files (->> (fs/list-dir test-dir)
                 (filter fs/regular-file?)
                 (map str)
                 (filter #(or (str/ends-with? % ".bb") (str/ends-with? % ".sh"))))
      ;; Comments are stripped FIRST, and that is not a detail: the first
      ;; version of this scan flagged three files, and all three hits were
      ;; prose - two of them THIS ticket's own retirement notes explaining why
      ;; the contract is gone. A source scan that cannot tell code from a
      ;; comment greens on prose, which is the failure mode the repo has
      ;; already been bitten by. What survives stripping is assertion text:
      ;; both retired contracts announced themselves in a failure message.
      strip-comments (fn [text]
                       (->> (str/split-lines text)
                            (remove #(re-matches #"^\s*(;;|#).*" %))
                            (str/join "\n")))
      offenders
      (keep (fn [f]
              (let [text (strip-comments (slurp f))
                    ;; The retired contract in words: a re-arm justified by a
                    ;; dead pid rather than by the cooldown.
                    ;; re-seq yields a VECTOR per match when the pattern has
                    ;; groups; element 0 is the whole line.
                    whole (fn [m] (if (vector? m) (first m) m))
                    claims (map whole (re-seq #"(?i)[^\n]*(dead pid|pid is dead)[^\n]*re-?arm[^\n]*" text))
                    inverse (map whole (re-seq #"(?i)[^\n]*re-?arm[^\n]*(without waiting for cooldown|immediately)[^\n]*" text))
                    live (remove #(str/includes? % "BL-1088") (concat claims inverse))]
                (when (seq live) [f (vec live)])))
            files)]
  (doseq [[f lines] offenders]
    (swap! failures conj
           (str "FAIL P3 (invariant 3: one contract per behaviour)\n  file: " f
                "\n  a live assertion still demands a re-arm justified by a dead pid rather than the cooldown:\n    "
                (str/join "\n    " (map str/trim lines)))))
  ;; Non-vacuity: the scan must actually be reading files, or it "passes" by
  ;; looking at nothing.
  (when (< (count files) 100)
    (swap! failures conj (str "FAIL P3 coverage: scanned only " (count files) " test files"))))

(doseq [[k floor] {:inside 40 :at-boundary 40 :past 40 :pid-alive 70 :pid-dead 70
                   :short-cooldown 20 :long-cooldown 20}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1088 give-up cooldown properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
