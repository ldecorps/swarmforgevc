#!/usr/bin/env bb
;; BL-1614 coder pass (BL-654 Invariants): a PROPERTY test over
;; work_note_evidence_lib.bb/work-note-completion-decision's new fourth
;; input, encoding the ticket's one declared invariant:
;;
;;   "A Work note is never completed with a no-work reason while its ticket
;;    sits in backlog/active on main: the completion helper reads that fact
;;    from the ref, never from the worktree, on every invocation with a
;;    reason."
;;
;; The reading-from-the-ref half is proven separately by the acceptance
;; feature (specs/features/BL-1614-*.feature scenario 01, real git fixture);
;; this property proves the PURE decision table itself never lets a stated
;; reason through as :complete-with-reason while active-on-main? is true -
;; over the full ticket-id x evidenced? x active-on-main? space, not just
;; the acceptance feature's six hand-picked rows.
;;
;; Same deterministic-seeded-LCG shape as
;; bl1422_work_note_not_completed_without_work_property_runner.bb (BL-472:
;; no mutation/property tooling wired for Babashka - this sweep is the
;; enforced gate for .bb code per the engineering article).
;;
;; Non-vacuity proven by hand at authoring time (mutant restored before this
;; commit; `diff` against a pre-break backup confirmed exact restoration):
;;   - run against a deliberately broken work-note-completion-decision where
;;     the `(and (some? reason) active-on-main?)` clause was dropped
;;     (falling straight through to the old `(some? reason)` clause
;;     regardless of active-on-main?) - failed on every generated case with
;;     a non-nil ticket-id, a stated reason, and active-on-main?=true
;;     (expected :refuse-active-on-main, got :complete-with-reason - exactly
;;     the silent-drop the invariant forbids).

(ns bl1614-work-note-active-on-main-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "work_note_evidence_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(= 1 n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 13]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── the declared invariant: a reason on an active-on-main ticket is
;;    ALWAYS refused, whatever evidenced? says ─────────────────────────────

(def sample-ticket-ids [nil "BL-9001" "BL-1" "GH-42"])

;; Ternary generator for active-on-main? itself: true, false, and nil (the
;; unreadable-ref case, which the invariant text calls out explicitly as
;; behaving like false, never a refusal of its own) - every generated case
;; below exercises all three, not just the two-value simplification a
;; boolean generator would silently narrow to.
(def sample-active-on-main [true false nil])

(defn gen-active-on-main [s]
  (let [[ti s1] (gen-int s (count sample-ticket-ids))
        [evidenced? s2] (gen-bool s1)
        [has-reason? s3] (gen-bool s2)
        [ai s4] (gen-int s3 (count sample-active-on-main))]
    [{:ticket-id (nth sample-ticket-ids ti)
      :evidenced? evidenced?
      :reason (when has-reason? "some stated reason")
      :active-on-main? (nth sample-active-on-main ai)}
     s4]))

(check-all "the declared invariant: a stated reason on a ticket active on main is always refused, never recorded"
  gen-active-on-main
  (fn [{:keys [ticket-id evidenced? reason active-on-main?]}]
    (let [actual (work-note-evidence-lib/work-note-completion-decision ticket-id evidenced? reason active-on-main?)]
      (if (and (some? ticket-id) (some? reason) (true? active-on-main?))
        (or (= :refuse-active-on-main actual)
            (str "expected :refuse-active-on-main, got " actual
                 " - a no-work reason was let through while active-on-main? was true"))
        true))))

;; The FULL table, restated to also cover false/nil active-on-main? cases -
;; a belt-and-braces re-check of the same table the BL-1422 property runner
;; already covers at active-on-main?=false, now also at nil, so the new
;; input's OWN third value gets full decision-table coverage too, not only
;; the invariant's narrow slice above.
(check-all "the full decision table holds for every active-on-main? value (true/false/nil)"
  gen-active-on-main
  (fn [{:keys [ticket-id evidenced? reason active-on-main?]}]
    (let [expected (cond
                      (nil? ticket-id) :complete-plain
                      (and (some? reason) active-on-main?) :refuse-active-on-main
                      (some? reason) :complete-with-reason
                      evidenced? :complete-plain
                      :else :refuse)
          actual (work-note-evidence-lib/work-note-completion-decision ticket-id evidenced? reason active-on-main?)]
      (or (= expected actual)
          (str "expected " expected " got " actual)))))

;; ── generator coverage (asserted reachability floors) ──────────────────────

(let [inputs (loop [i 0 s 13 acc []]
               (if (= i runs) acc (let [[in s'] (gen-active-on-main s)] (recur (inc i) s' (conj acc in)))))
      buckets {:refuse-active-on-main-case (count (filter #(and (some? (:ticket-id %)) (some? (:reason %)) (true? (:active-on-main? %))) inputs))
               :active-on-main-false (count (filter #(false? (:active-on-main? %)) inputs))
               :active-on-main-nil (count (filter #(nil? (:active-on-main? %)) inputs))
               :active-on-main-true (count (filter #(true? (:active-on-main? %)) inputs))}
      floor (quot runs 20)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 13 buckets (str k " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1614 work-note-active-on-main properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
