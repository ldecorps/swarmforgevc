#!/usr/bin/env bb
;; BL-798 architect bounce D1 (BL-654 Invariants): PROPERTY test over
;; chase_sweep_lib.bb's decide-open-slot-escalation, encoding the ticket's
;; declared invariant 2:
;;
;;   "Repeated unacted nudges escalate past a bounded count, never repeat
;;    silently." For an arbitrary threshold and an arbitrary-length run of
;;    sweep ticks against a FIXED top candidate, :escalate fires at most
;;    once, and once it fires every later tick for that same candidate is
;;    :none forever (until the candidate changes) - never a repeat
;;    escalation and never a further silent :nudge.
;;
;; Mirrors provider_auth_observe_lib_property_runner.bb's P1/P2 shape (same
;; per-episode bounded-count-then-quiet state machine, cited by the
;; architect's bounce evidence as the precedent this ticket's own commit
;; message already claims to mirror). Deterministic by construction: a
;; seeded LCG, never rand.
;;
;; Episode structure: each episode is a run of N ticks against ONE candidate
;; id; episodes are back-to-back with a DIFFERENT candidate id each time,
;; which is itself enough to force next-open-slot-escalation-state's reset
;; branch (no separate "healthy tick" needed the way the auth-observe
;; precedent needs one - a changed candidate-id resets unconditionally).
;;
;; Non-vacuity proven by hand at authoring time (mutant restored before this
;; commit; `git diff` showed no residual change after restoring): removed
;; the `(not (:escalated state))` guard in decide-open-slot-escalation (so
;; it re-escalates on every tick once at/above threshold, instead of going
;; quiet) - P2 failed on the first generated episode whose length exceeded
;; the threshold, escalate-count > 1 every time.

(ns bl798-open-slot-escalation-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

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

;; ── generator: an arbitrary threshold + a handful of episode run-lengths,
;;    each episode against its own fresh candidate id ──────────────────────

(defn gen-episodes [s]
  (let [[thr-n s1] (gen-int s 8)
        threshold (inc thr-n)                                   ;; 1..8
        [extra-n s2] (gen-int s1 4)
        episodes-n (inc extra-n)                                ;; 1..4 episodes
        [lengths s3] (reduce (fn [[acc sx] _]
                                ;; 0..(threshold+5): both sides of the
                                ;; threshold are common, never a rare tail
                                (let [[len sy] (gen-int sx (+ threshold 6))]
                                  [(conj acc len) sy]))
                              [[] s2] (range episodes-n))]
    [{:threshold threshold :lengths lengths} s3]))

;; ── run a sequence of episodes through decide-open-slot-escalation,
;;    threading state across ticks; each episode uses its own candidate id,
;;    which forces a reset boundary between episodes on its own ───────────

(defn run-episodes [threshold lengths]
  (loop [state nil eps lengths idx 0 acc []]
    (if (empty? eps)
      acc
      (let [len (first eps)
            candidate-id (str "BL-CAND-" idx)
            [actions state'] (loop [k 0 st state as []]
                                (if (= k len)
                                  [as st]
                                  (let [decision (chase-sweep-lib/decide-open-slot-escalation
                                                   st candidate-id threshold)]
                                    (recur (inc k) (:state decision) (conj as (:action decision))))))]
        (recur state' (rest eps) (inc idx) (conj acc {:length len :actions actions}))))))

;; ── P1: escalate fires 0 or 1 times per episode, never more, and exactly
;;    once iff the episode's length reaches the threshold ──────────────────

(check-all "P1 escalate count per candidate-episode is exactly 0 (length < threshold) or 1 (length >= threshold), never more"
  gen-episodes
  (fn [{:keys [threshold lengths]}]
    (let [episodes (run-episodes threshold lengths)]
      (or (every? (fn [{:keys [length actions]}]
                    (let [expected (if (>= length threshold) 1 0)
                          escalate-count (count (filter #(= :escalate %) actions))]
                      (= escalate-count expected)))
                  episodes)
          (str "threshold=" threshold " episodes=" (pr-str episodes))))))

;; ── P2: once :escalate fires within an episode, every later tick in that
;;    same episode is :none - never a repeat :escalate, never a further
;;    silent :nudge ──────────────────────────────────────────────────────

(check-all "P2 once :escalate fires, every remaining tick in the same candidate-episode is :none (no repeat escalate, no further silent nudge)"
  gen-episodes
  (fn [{:keys [threshold lengths]}]
    (let [episodes (run-episodes threshold lengths)]
      (or (every? (fn [{:keys [actions]}]
                    (let [escalate-idx (first (keep-indexed (fn [i a] (when (= :escalate a) i)) actions))]
                      (or (nil? escalate-idx)
                          (every? #(= :none %) (drop (inc escalate-idx) actions)))))
                  episodes)
          (str "threshold=" threshold " episodes=" (pr-str episodes))))))

;; ── generator coverage, asserted rather than assumed - both under-threshold
;;    AND at-or-past-threshold episode lengths must actually be generated ──

(let [buckets (loop [i 0 s 11 acc {:under-threshold 0 :at-or-past-threshold 0}]
                (if (= i runs)
                  acc
                  (let [[{:keys [threshold lengths]} s'] (gen-episodes s)]
                    (recur (inc i) s'
                           (reduce (fn [a len]
                                     (update a (if (>= len threshold) :at-or-past-threshold :under-threshold) inc))
                                   acc lengths)))))
      floor (quot runs 10)]
  (println (str "  generator coverage (episode lengths vs. threshold): " (pr-str buckets)))
  (doseq [b [:under-threshold :at-or-past-threshold]]
    (when (< (get buckets b 0) floor)
      (report! (str "COVERAGE " b) 11 buckets (str b " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "chase_sweep_lib open-slot-escalation properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
