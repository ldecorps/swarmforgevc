#!/usr/bin/env bb
;; BL-1469 coder pass (BL-654 Invariants): a PROPERTY test over
;; promotion_gates_lib.bb's not-before-refusal / evaluate, encoding the
;; ticket's two declared invariants against the REAL functions, never a
;; reimplementation:
;;
;;   1. "No path promotes a ticket before its declared not_before UTC
;;      date - routine promotion, the batch promotion after an approval
;;      sweep, or a caller-declared queue-jump - and the refusal names
;;      the date."
;;   2. "Fail closed on a malformed date, neutral on an absent one; the
;;      predicate exists once in promotion_gates_lib.bb and
;;      promote_and_route_next.sh reaches it through the gates CLI, never
;;      through a second regex of its own."
;;
;; P1 covers invariant 1's testable half: a random (date, queue-jump?)
;; pair, asserting a future date always refuses (naming the date and the
;; exact day count) through BOTH not-before-refusal directly and evaluate
;; end-to-end, with queue-jump? true or false making no difference, and a
;; non-future date never refuses either way.
;;
;; P2/P3 cover invariant 2's testable half: a random malformed value
;; always refuses naming the value (P2); a ticket declaring no not_before
;; at all is always neutral, whatever else it declares (P3). Invariant 2's
;; other half - "the predicate exists once ... never a second regex" - is
;; an architectural claim about promote_and_route_next.sh, not a property
;; over inputs; verified by hand at authoring time (BL-654's stated-reason
;; allowance): `grep -n not_before swarmforge/scripts/promote_and_route_
;; next.sh` and a grep for a YYYY-MM-DD-shaped regex in that file both come
;; back empty - it reaches this gate only through promotion_gates_cli.bb's
;; `select`/`gate-promotion`, unchanged by this ticket.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners. Never `rand`, never a real clock - `today` is a fixed entry in
;; a small literal calendar, so every generated case is immune to whatever
;; date this actually runs on.
;;
;; Non-vacuity proven by hand at authoring time: not-before-refusal
;; temporarily stashed out of promotion_gates_lib.bb (git stash), P1/P2
;; both failed on every generated case (P1: no refusal ever fires for a
;; future date; P2: the symbol itself does not resolve), restored after.

(ns bl1469-not-before-promotion-gate-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "promotion_gates_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 60))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 1469]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

;; A small fixed calendar so date arithmetic never needs java.time in the
;; generator itself - each entry a real YYYY-MM-DD date, ascending, so
;; index arithmetic already IS day-offset arithmetic.
(def CALENDAR
  ["2026-01-01" "2026-01-02" "2026-01-03" "2026-01-04" "2026-01-05"
   "2026-01-06" "2026-01-07" "2026-01-08" "2026-01-09" "2026-01-10"
   "2026-01-11" "2026-01-12" "2026-01-13" "2026-01-14" "2026-01-15"])
(def TODAY-IDX 7)
(def TODAY (nth CALENDAR TODAY-IDX))

;; ── P1: a future not_before always refuses (queue-jump included);
;; a past-or-today one never does ────────────────────────────────────────

(defn gen-p1 [s]
  (let [[date-idx s1] (gen-int s (count CALENDAR))
        [qj s2] (gen-int s1 2)]
    [{:date (nth CALENDAR date-idx) :offset (- date-idx TODAY-IDX) :queue-jump? (= 1 qj)} s2]))

(defn- p1-case [{:keys [date offset queue-jump?]}]
  (let [content (str "not_before: " date "\n")
        r (promotion-gates-lib/not-before-refusal content TODAY)
        ev (promotion-gates-lib/evaluate {:content content :held? false :active-count 0 :max-depth 5
                                           :active-epics {} :today TODAY :queue-jump? queue-jump?})]
    (cond
      (and (pos? offset) (nil? r))
      (str "expected a refusal for a future date " date " (offset " offset "), got nil")

      (and (pos? offset) (not (str/includes? (:reason r) (str offset " day"))))
      (str "expected the refusal to name " offset " day(s) away, got: " (:reason r))

      (and (pos? offset) (not= "not_before" (:gate ev)))
      (str "expected evaluate to refuse on gate not_before (queue-jump?=" queue-jump? "), got: " (pr-str ev))

      (and (not (pos? offset)) (some? r))
      (str "expected no refusal for a non-future date " date " (offset " offset "), got: " (pr-str r))

      (and (not (pos? offset)) (not (:ok ev)))
      (str "expected evaluate to allow a non-future not_before, got: " (pr-str ev))

      :else true)))

(check-all "P1: a future not_before always refuses (queue-jump included), past-or-today never does" gen-p1 p1-case)

;; ── P2: a malformed not_before always refuses, naming the value ──────────

(def MALFORMED ["next-tuesday" "2026/01/08" "not-a-date" "08-01-2026" "yesterday" "2026-13-40"])

(defn gen-p2 [s]
  (let [[idx s1] (gen-int s (count MALFORMED))] [(nth MALFORMED idx) s1]))

(defn- p2-case [value]
  (let [content (str "not_before: " value "\n")
        r (promotion-gates-lib/not-before-refusal content TODAY)]
    (cond
      (nil? r) (str "expected a refusal for the malformed value " (pr-str value) ", got nil")
      (not= "not_before" (:gate r)) (str "expected gate not_before, got " (:gate r))
      (not (str/includes? (:reason r) value))
      (str "expected the refusal to name the value " (pr-str value) ", got: " (:reason r))
      :else true)))

(check-all "P2: a malformed not_before always refuses, naming the value" gen-p2 p2-case)

;; ── P3: an absent not_before is always neutral, whatever else the ticket
;; declares ────────────────────────────────────────────────────────────

(def OTHER-FIELDS ["id: BL-1\n" "human_approval: pending\n" "status: todo\n" "type: feature\npriority: 5\n"])

(defn gen-p3 [s]
  (let [[idx s1] (gen-int s (count OTHER-FIELDS))] [(nth OTHER-FIELDS idx) s1]))

(defn- p3-case [other-content]
  (let [r (promotion-gates-lib/not-before-refusal other-content TODAY)]
    (if (some? r)
      (str "expected nil (neutral) with no not_before field, got: " (pr-str r))
      true)))

(check-all "P3: an absent not_before is always neutral, whatever else the ticket declares" gen-p3 p3-case)

;; ── generator coverage (asserted reachability floors) ────────────────────

(let [p1-inputs (sweep-coverage 1469 gen-p1 identity)
      floor (quot runs 10)
      buckets {:p1-future (count (filter #(pos? (:offset %)) p1-inputs))
               :p1-past-or-today (count (remove #(pos? (:offset %)) p1-inputs))
               :p1-queue-jump (count (filter :queue-jump? p1-inputs))
               :p1-no-queue-jump (count (remove :queue-jump? p1-inputs))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 1469 buckets (str k " barely exercised: " v " <= floor " floor)))))

;; ── report ────────────────────────────────────────────────────────────────

(println (str "bl1469 not-before-promotion-gate properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
