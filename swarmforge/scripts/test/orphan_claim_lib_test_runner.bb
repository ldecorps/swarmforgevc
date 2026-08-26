#!/usr/bin/env bb
;; TDD runner for orphan_claim_lib.bb (BL-648).

(ns orphan-claim-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "orphan_claim_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; BL-648-04: dead owner, not the resumed role -> reclaim
(assert-true "dead owner, unrelated role -> reclaim"
             (orphan-claim-lib/claim-reclaim?
              {:has-claim? true :owner-alive? false :being-resumed? false}))

;; BL-648-05: owner alive -> never reclaimed, regardless of resumed-role status
(assert-false "owner alive -> never reclaimed"
              (orphan-claim-lib/claim-reclaim?
               {:has-claim? true :owner-alive? true :being-resumed? false}))
(assert-false "owner alive even if somehow also flagged as being-resumed -> never reclaimed"
              (orphan-claim-lib/claim-reclaim?
               {:has-claim? true :owner-alive? true :being-resumed? true}))

;; BL-648-01: the role being resumed keeps its claim untouched even though
;; its previous (dead) session is exactly why we're resuming it.
(assert-false "being-resumed role's dead-owner claim is left for the resume to pick up"
              (orphan-claim-lib/claim-reclaim?
               {:has-claim? true :owner-alive? false :being-resumed? true}))

;; No claim at all is always a no-op, regardless of the other two flags.
(assert-false "no claim -> nothing to reclaim"
              (orphan-claim-lib/claim-reclaim?
               {:has-claim? false :owner-alive? false :being-resumed? false}))
(assert-false "no claim -> nothing to reclaim (even if flagged alive/resumed)"
              (orphan-claim-lib/claim-reclaim?
               {:has-claim? false :owner-alive? true :being-resumed? true}))

(if (seq @failures)
  (do
    (binding [*out* *err*]
      (doseq [f @failures] (println f)))
    (System/exit 1))
  (println "orphan_claim_lib_test_runner: ok"))
