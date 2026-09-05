#!/usr/bin/env bb
;; BL-1422 coder pass (BL-654 Invariants): PROPERTY tests over
;; work_note_evidence_lib.bb's two pure functions, encoding the ticket's
;; three declared invariants:
;;
;;   1 & 3. work-note-completion-decision's full decision table: a nil
;;      ticket-id (every non-Work note, every git_handoff) ALWAYS
;;      completes plainly regardless of evidenced?/reason (invariant 3 -
;;      "completes exactly as today"); a non-nil ticket-id with a stated
;;      reason always completes-with-reason (never silently dropped);
;;      with no reason, evidence completes plainly and its absence
;;      refuses - never the other way around (invariant 1).
;;   2. work-note-ticket-id-from-message is chase-sweep-lib's dispatch-
;;      trail-ticket-id and NOTHING else: for an arbitrary message string,
;;      the wrapper's answer is always identical to calling the shared
;;      parser directly with the same message - proven non-vacuous below
;;      against a deliberately introduced SECOND regex that answers
;;      differently for at least one generated case.
;;
;; Same deterministic-seeded-LCG shape as provider_auth_observe_lib_property_
;; runner.bb (BL-472: no mutation/property tooling wired for Babashka - this
;; sweep is the enforced gate for .bb code per the engineering article).
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored
;; before this commit; `diff` against a pre-break backup confirmed exact
;; restoration):
;;   - P1 was run against a deliberately broken work-note-completion-
;;     decision where the nil-ticket-id clause was dropped (falling through
;;     to the reason/evidenced?/refuse clauses even for a nil ticket-id,
;;     the pre-BL-1422 shape generalized wrong) - failed on every generated
;;     case with a nil ticket-id, no reason, and evidenced?=false (expected
;;     :complete-plain, got :refuse).
;;   - P2 was run against a deliberately broken work-note-ticket-id-from-
;;     message that ALSO recognised a bare leading ticket id with no verb
;;     ("BL-123 ..." with no "Work"/"Spec" prefix) - a second regex
;;     alongside the shared parser - failed on every generated message of
;;     that exact shape (a mention-only note, not a router dispatch).

(ns bl1422-work-note-not-completed-without-work-property-runner
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

;; ── P1 (invariants 1 and 3): the full decision table ───────────────────────

(def sample-ticket-ids [nil "BL-9001" "BL-1" "GH-42"])

(defn gen-p1 [s]
  (let [[ti s1] (gen-int s (count sample-ticket-ids))
        [evidenced? s2] (gen-bool s1)
        [has-reason? s3] (gen-bool s2)]
    [{:ticket-id (nth sample-ticket-ids ti)
      :evidenced? evidenced?
      :reason (when has-reason? "some stated reason")}
     s3]))

(check-all "P1: work-note-completion-decision matches the full decision table (invariants 1 and 3)"
  gen-p1
  (fn [{:keys [ticket-id evidenced? reason]}]
    (let [expected (cond
                      (nil? ticket-id) :complete-plain
                      (some? reason) :complete-with-reason
                      evidenced? :complete-plain
                      :else :refuse)
          actual (work-note-evidence-lib/work-note-completion-decision ticket-id evidenced? reason)]
      (or (= expected actual)
          (str "expected " expected " got " actual)))))

;; ── P2 (invariant 2): the wrapper is nothing but the shared parser ─────────

(def message-fragments
  ["Work BL-9001-some-slug: read file in backlog/active"
   "Spec BL-1234-another-slug: read"
   "branch behind abc1234567: dirty worktree - merge up"
   "BL-9001 active, spec-complete, no assignee"
   "Work BL-1: read file in backlog/active"
   "GH-42 active, spec-complete"
   "just some prose with no ticket id at all"
   "Work GH-42-slug: read file in backlog/active"
   ""])

(defn gen-p2 [s]
  (let [[mi s1] (gen-int s (count message-fragments))]
    [(nth message-fragments mi) s1]))

(check-all "P2: work-note-ticket-id-from-message is exactly chase-sweep-lib/dispatch-trail-ticket-id, no second regex"
  gen-p2
  (fn [message]
    (let [expected (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message message})
          actual (work-note-evidence-lib/work-note-ticket-id-from-message message)]
      (or (= expected actual)
          (str "expected " (pr-str expected) " got " (pr-str actual))))))

;; ── generator coverage (asserted reachability floors) ──────────────────────

(let [p1-inputs (loop [i 0 s 13 acc []]
                  (if (= i runs) acc (let [[in s'] (gen-p1 s)] (recur (inc i) s' (conj acc in)))))
      p2-inputs (loop [i 0 s 13 acc []]
                  (if (= i runs) acc (let [[in s'] (gen-p2 s)] (recur (inc i) s' (conj acc in)))))
      buckets {:p1-nil-ticket (count (filter #(nil? (:ticket-id %)) p1-inputs))
               :p1-has-reason (count (filter #(some? (:reason %)) p1-inputs))
               :p1-evidenced-no-reason (count (filter #(and (:evidenced? %) (nil? (:reason %))) p1-inputs))
               :p1-refuse-case (count (filter #(and (not (:evidenced? %)) (nil? (:reason %)) (some? (:ticket-id %))) p1-inputs))
               :p2-dispatch-form (count (filter #(re-find #"(?i)\b(Spec|Work)\s+" %) p2-inputs))
               :p2-no-match (count (filter #(nil? (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message %})) p2-inputs))}
      floor (quot runs 10)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 13 buckets (str k " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1422 work-note-not-completed-without-work properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
