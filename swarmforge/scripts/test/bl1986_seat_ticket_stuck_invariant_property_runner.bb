#!/usr/bin/env bb
;; BL-1986 coder pass (BL-654 Invariants): PROPERTY test over
;; babysitterd_sweep_lib.bb/check-seat-ticket-stuck encoding the ticket's
;; declared invariant: "The seat-stuck CRIT never fires for a seat that has
;; committed for its ticket since the claim, and its key and severity are
;; the same whichever trigger fired it."
;;
;; check-seat-ticket-stuck itself is BL-1985's unchanged function (this
;; ticket only supplies one of its inputs, :loop-dialog?, from the real
;; gatherer - specs/features/BL-1986-...feature's own acceptance scenario
;; proves THAT wiring end to end). This property is over the pure function
;; the invariant actually names, so BL-1986 - the ticket re-declaring the
;; same invariant text - authors it first, per BL-654's "no path leaves the
;; architect authoring it".
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand). See ambulance_lib_property_runner.bb's
;; header for the Babashka-property-tooling-gap note (BL-472) this one
;; shares: no test.check equivalent is wired for .bb scripts.
;;
;; Non-vacuity proven by hand at authoring time: P1 failed (reported a
;; false "committed since claim still stuck" violation) when the :when
;; filter's (filter :head-unchanged? items) line was temporarily removed;
;; P2 failed (reported a key/severity mismatch) when the :key was changed
;; to interpolate the trigger name alongside the role. Both reverted before
;; this commit.

(ns bl1986-seat-ticket-stuck-invariant-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitterd_sweep_lib.bb")))
(require '[babysitterd-sweep-lib :as sw])

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(zero? n) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 11]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(def role-pool ["coder" "coder@2" "architect"])
;; Below, at, and past the 60m threshold - seat-ticket-stuck-min itself read
;; from the real def, never a restated literal (invariant 2 reasoning: a
;; changed threshold must not silently desync the generator from the check).
(def dwell-pool [0 1 59 60 61 180])
(def repeat-pool [0 1 9 10 11 50])

(defn gen-scenario [s]
  (let [[role s1] (gen-pick s role-pool)
        [dwell s2] (gen-int s1 (count dwell-pool))
        [head-unchanged? s3] (gen-bool s2)
        [loop-dialog? s4] (gen-bool s3)
        [repeats s5] (gen-int s4 (count repeat-pool))
        [busy? s6] (gen-bool s5)]
    [{:role role
      :task "BL-9001"
      :dwell-min (nth dwell-pool dwell)
      :head-unchanged? head-unchanged?
      :loop-dialog? loop-dialog?
      :repeat-notes-since-claim (nth repeat-pool repeats)
      :busy? busy?}
     s6]))

(defn- any-trigger? [{:keys [dwell-min loop-dialog? repeat-notes-since-claim]}]
  (or (>= (long (or dwell-min 0)) sw/seat-ticket-stuck-min)
      (boolean loop-dialog?)
      (>= (long (or repeat-notes-since-claim 0)) 10)))

;; ── P1: a commit since the claim clears the finding, whatever else is true ──

(check-all "P1 committed-since-claim-never-stuck: head-unchanged? false never produces a finding" gen-scenario
  (fn [ticket]
    (let [scenario (assoc ticket :head-unchanged? false)
          fs (sw/check-seat-ticket-stuck [scenario] false)]
      (if (seq fs)
        (str "expected no finding for a seat with a commit since the claim, got " (pr-str fs))
        true))))

;; ── P2: whichever trigger fired, the key and severity are the same ─────────
;; Explicit shapes first (guarantees every trigger fires alone at least
;; once - a random draw over three independent booleans/counters would
;; otherwise make "loop-dialog? alone, dwell under threshold, repeats under
;; 10" a 1-in-many draw, exactly the kind of rare corner a weighted
;; generator misses).

(def explicit-shapes
  [{:role "coder" :task "BL-9001" :dwell-min 61 :head-unchanged? true
    :loop-dialog? false :repeat-notes-since-claim 0 :busy? false} ; dwell alone
   {:role "coder" :task "BL-9001" :dwell-min 1 :head-unchanged? true
    :loop-dialog? true :repeat-notes-since-claim 0 :busy? false} ; loop-dialog alone
   {:role "coder" :task "BL-9001" :dwell-min 1 :head-unchanged? true
    :loop-dialog? false :repeat-notes-since-claim 10 :busy? false} ; repeat-notes alone
   {:role "coder" :task "BL-9001" :dwell-min 61 :head-unchanged? true
    :loop-dialog? true :repeat-notes-since-claim 10 :busy? true}]) ; all three together

(defn- same-key-and-severity? [ticket]
  (if (and (:head-unchanged? ticket) (any-trigger? ticket))
    (let [fs (sw/check-seat-ticket-stuck [ticket] false)]
      (cond
        (not= 1 (count fs)) (str "expected exactly one finding, got " (count fs) ": " (pr-str fs))
        (not= (str "seat-stuck-" (:role ticket)) (:key (first fs)))
        (str "key was " (:key (first fs)) ", expected seat-stuck-" (:role ticket))
        (not= "CRIT" (:severity (first fs)))
        (str "severity was " (:severity (first fs)) ", expected CRIT")
        :else true))
    true)) ;; not a stuck shape at all - nothing to check for THIS property

(doseq [shape explicit-shapes]
  (let [result (same-key-and-severity? shape)]
    (when-not (true? result)
      (report! "P2 same-key-and-severity (explicit shape)" :n/a shape (str result)))))

(check-all "P2 same-key-and-severity: whichever trigger(s) fired, the key and severity never vary" gen-scenario
  same-key-and-severity?)

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1986 check-seat-ticket-stuck invariant properties: " runs " runs each, plus " (count explicit-shapes) " explicit shapes"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
