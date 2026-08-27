#!/usr/bin/env bb
;; BL-953 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over task_commit_coherence_gate_lib.bb's
;; blocked?, encoding declared invariants 1 and 2:
;;
;;   invariant 1 - "Fail-open is absolute. Only a POSITIVE, resolved
;;      contradiction may refuse": across generated (task-id, commit-ids)
;;      pairs, blocked? is true iff the commit resolved to at least one id
;;      AND the task's id (itself resolved) is not among them - and false
;;      for every ambiguous shape (nil task id, nil/empty commit ids).
;;   invariant 2 - "Ticket identity is exact id equality, never prefix or
;;      substring": collision pairs are built BY CONSTRUCTION (one side
;;      derived from the other by appending/stripping a digit - the
;;      BL-93/BL-935 and BL-95/BL-953 trap), so every generated case is a
;;      prefix-collision candidate, never a hoped-for rare draw
;;      (coder.prompt's own collision-pair rule).
;;
;;   invariant 3 ("a refused send has no side effects") is NOT encoded
;;   here: it quantifies over validate's shared refusal machinery in
;;   swarm_handoff.bb (all-errors -> error-report -> exit 2 before any
;;   write), not over this pure decision's input space - the acceptance
;;   suite's scenario 02 asserts the empty mailboxes on a real refused
;;   send instead.
;;
;; Same seeded convention as this directory's other property runners.
;; expected-blocked? restates the invariant text independently.
;;
;; Non-vacuity proven by hand at authoring time: replacing blocked?'s
;; exact-equality membership with a prefix match (str/starts-with?) fails
;; the collision property on its first constructed pair; forcing blocked?
;; to true on empty commit-ids fails the fail-open property immediately.
;; Both restored before landing.

(ns bl953-task-commit-coherence-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "task_commit_coherence_gate_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 2000))
(def failures (atom []))
(def ^:private rng (java.util.Random. 953))
(defn- rint [n] (.nextInt rng (int n)))
(defn- rpick [coll] (nth (vec coll) (rint (count coll))))
(defn- rbool [] (.nextBoolean rng))

(defn- rid []
  (str (rpick ["BL" "GH"]) "-" (inc (rint 999))))

;; Collision pairs BY CONSTRUCTION: derive the sibling from the base by the
;; exact transformation a substring/prefix matcher conflates.
(defn- collide [id]
  (if (rbool)
    (str id (rint 10))                       ; BL-93 -> BL-935
    (if (> (count id) 4)
      (subs id 0 (dec (count id)))            ; BL-935 -> BL-93
      (str id (rint 10)))))

(defn expected-blocked? [{:keys [task-ticket-id commit-ticket-ids]}]
  (boolean (and (some? task-ticket-id)
                (seq commit-ticket-ids)
                (not-any? #(= % task-ticket-id) commit-ticket-ids))))

(def fire-reached (atom 0))
(def collision-cases-reached (atom 0))

(dotimes [_ runs]
  (let [base (rid)
        shape (rint 5)
        scenario (case shape
                   0 {:task-ticket-id base :commit-ticket-ids [base]}                      ; exact match
                   1 {:task-ticket-id base :commit-ticket-ids [(collide base)]}             ; constructed collision
                   2 {:task-ticket-id base :commit-ticket-ids nil}                          ; no ids at all
                   3 {:task-ticket-id nil :commit-ticket-ids [(rid)]}                       ; task resolves to nothing
                   4 {:task-ticket-id base :commit-ticket-ids [(rid) (rid) (if (rbool) base (collide base))]})
        expected (expected-blocked? scenario)
        actual (task-commit-coherence-gate-lib/blocked? scenario)]
    (when (= 1 shape) (swap! collision-cases-reached inc))
    (when expected (swap! fire-reached inc))
    (when (not= expected actual)
      (swap! failures conj (str "FAIL: expected " expected " got " actual " for " (pr-str scenario))))
    ;; invariant 2, stated directly: a constructed collision NEVER counts as
    ;; a match - blocked? must be true for shape 1 whenever the collided id
    ;; genuinely differs from the base.
    (when (and (= 1 shape) (not= base (first (:commit-ticket-ids scenario))))
      (when-not actual
        (swap! failures conj (str "FAIL invariant 2: prefix-sibling " (pr-str scenario) " was treated as a match"))))))

(when (zero? @fire-reached)
  (swap! failures conj "FAIL reachability: the refusing shape never generated"))
(when (zero? @collision-cases-reached)
  (swap! failures conj "FAIL reachability: no constructed collision pair generated"))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl953_task_commit_coherence_property_runner: ok (" runs " runs, "
                @fire-reached " refusing shapes, " @collision-cases-reached " constructed collisions)")))
