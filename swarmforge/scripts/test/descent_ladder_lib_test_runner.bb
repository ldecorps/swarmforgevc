#!/usr/bin/env bb
;; BL-1327: TDD runner for descent_ladder_lib.bb - the scheduled descent
;; ladder's PURE decision. Slice 1 proposes a notch and never applies one
;; (human ruling 2026-09-02: proposal-only), so every assertion here is about
;; what is PROPOSED and about ladder state, never about a live seat.

(ns descent-ladder-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "descent_ladder_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(def base
  {:seat "coder"
   :current-effort "xhigh"
   :current-model "claude-opus-5"
   :model-ladder ["claude-opus-5" "claude-sonnet-5" "claude-haiku-4-5"]
   :clean-periods 0
   :required-clean-periods 3
   :guard-tripped? false})

;; ── invariant 1: a single clean period never proposes a move ─────────────

(let [d (descent-ladder-lib/descent-decision (assoc base :clean-periods 1))]
  (assert-false "one clean period proposes nothing" (:propose? d))
  (assert-includes "and says how far short the streak is" (:reason d) "1/3"))

(let [d (descent-ladder-lib/descent-decision (assoc base :clean-periods 2))]
  (assert-false "two clean periods propose nothing either" (:propose? d)))

(let [d (descent-ladder-lib/descent-decision (assoc base :clean-periods 3))]
  (assert-true "the full streak proposes a notch" (:propose? d))
  (assert= "and it is the next LOWER effort, one notch" "high" (:effort (:proposal d)))
  (assert= "on the same model - effort before model" "claude-opus-5" (:model (:proposal d))))

;; ── invariant 3: effort is exhausted before a cheaper model ──────────────

(let [d (descent-ladder-lib/descent-decision (assoc base :current-effort "medium" :clean-periods 3))]
  (assert= "a middle effort notch still descends by effort" "low" (:effort (:proposal d)))
  (assert= "and never changes the model while effort remains" "claude-opus-5" (:model (:proposal d))))

(let [d (descent-ladder-lib/descent-decision (assoc base :current-effort "low" :clean-periods 3))]
  (assert-true "with effort exhausted, a cheaper model is proposed" (:propose? d))
  (assert= "the next cheaper model on the ladder" "claude-sonnet-5" (:model (:proposal d)))
  (assert= "at HIGH effort, never low - a smaller brain may need MORE deliberation"
           "high" (:effort (:proposal d)))
  (assert-includes "and the proposal records why it starts higher"
                   (:reason (:proposal d)) "deliberation"))

(let [d (descent-ladder-lib/descent-decision
         (assoc base :current-effort "low" :current-model "claude-haiku-4-5" :clean-periods 5))]
  (assert-false "the bottom of both ladders proposes nothing" (:propose? d))
  (assert-includes "and says it is terminal" (:reason d) "terminal"))

;; ── invariant 2: a guard trip discards progress and climbs back ──────────

(let [state {:effort "medium" :model "claude-sonnet-5" :clean-periods 2
             :last-known-good {:effort "high" :model "claude-opus-5"}}
      after (descent-ladder-lib/record-guard-trip state)]
  (assert= "a guard trip returns to the last known-good notch"
           {:effort "high" :model "claude-opus-5"}
           (select-keys after [:effort :model]))
  (assert= "and discards partial clean-period progress" 0 (:clean-periods after))
  (assert-includes "and says why" (:reason after) "guard trip"))

(let [state {:effort "high" :model "claude-opus-5" :clean-periods 2 :last-known-good nil}
      after (descent-ladder-lib/record-guard-trip state)]
  (assert= "with no known-good notch recorded, the seat stays where it is"
           {:effort "high" :model "claude-opus-5"}
           (select-keys after [:effort :model]))
  (assert= "and progress is still discarded" 0 (:clean-periods after)))

;; A guard-tripped seat never proposes in the same review.
(let [d (descent-ladder-lib/descent-decision (assoc base :clean-periods 3 :guard-tripped? true))]
  (assert-false "a seat whose guard tripped this period proposes nothing" (:propose? d))
  (assert-includes "and says so" (:reason d) "guard"))

;; ── scenario 04: a price-window shift re-walks the terminal state ────────

(let [d (descent-ladder-lib/descent-decision
         (assoc base :current-effort "low" :current-model "claude-haiku-4-5"
                :clean-periods 5
                :model-ladder ["claude-opus-5" "claude-sonnet-5" "claude-haiku-4-5" "cheaper-after-shift"]
                :price-window-shifted? true))]
  (assert-true "a price shift that adds a cheaper model re-walks a terminal seat" (:propose? d))
  (assert= "and proposes the newly-cheapest model" "cheaper-after-shift" (:model (:proposal d)))
  (assert-includes "naming the price window as the reason it moved again"
                   (:reason (:proposal d)) "price"))

(let [d (descent-ladder-lib/descent-decision
         (assoc base :current-effort "low" :current-model "claude-haiku-4-5"
                :clean-periods 5 :price-window-shifted? true))]
  (assert-false "a price shift that changes nothing proposes nothing" (:propose? d)))

;; ── proposal-only: the decision never carries an instruction to apply ────

(let [d (descent-ladder-lib/descent-decision (assoc base :clean-periods 3))]
  (assert-true "a proposal names the seat" (= "coder" (:seat (:proposal d))))
  (assert-true "a proposal names where it came from" (some? (:from (:proposal d))))
  (assert-false "and it is never marked applied" (:applied? (:proposal d)))
  (assert= "the decision exposes no apply verb at all" nil (:apply! d)))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: descent_ladder_lib.bb"))
