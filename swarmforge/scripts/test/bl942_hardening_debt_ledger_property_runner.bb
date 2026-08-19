#!/usr/bin/env bb
;; BL-942: PROPERTY tests over hardening_debt_ledger_lib.bb, covering the two
;; invariants the ticket YAML declares (coder-authored first, per BL-654).
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.
;; Follows the established .bb property-runner precedent
;; (bl848_hotfix_certification_property_runner.bb).
;;
;;   P1 deferred-vs-ran-are-never-indistinguishable - invariant 1: "A gate
;;      that did not run is never indistinguishable from a gate that passed
;;      — every deferral is recorded as a first-class, machine-readable row".
;;      Across many random trials, each generates a DEFERRED set (gates that
;;      took the bypass, each recorded 1-3 times to also exercise idempotent
;;      redelivery for free) and a disjoint RAN set (gates that completed,
;;      never recorded at all). outstanding-debt must name every deferred
;;      parcel and NONE of the ran ones - the exact "not indistinguishable"
;;      claim, checked over randomized parcel/gate/file-set/reason/load
;;      shapes rather than one fixed example.
;;
;;   P2 file-set-fidelity-no-cross-parcel-bleed - invariant 2: "The debt
;;      record names the exact file set that was skipped ... rather than a
;;      different parcel's scope". Across many random trials, two DISTINCT
;;      parcels each defer the SAME gate against their own randomly
;;      generated (and non-overlapping) file set, submitted in random order
;;      with random duplicates/whitespace. Each parcel's recorded row must
;;      equal exactly its OWN normalized file set - never empty, never
;;      missing an entry, and never containing a file from the other
;;      parcel's set.
;;
;; Non-vacuity, checked by hand before landing: record-deferral's dedup
;; check disabled (always append) fails P1's redelivery-count assertion
;; immediately; record-deferral's file-set carried through unnormalized
;; (raw request instead of new-row's normalized copy) fails P2 on its first
;; shuffled/duplicated case. Restoring the real implementation passes both
;; again.

(ns bl942-hardening-debt-ledger-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "hardening_debt_ledger_lib.bb")))
(require '[hardening-debt-ledger-lib :as hdl])

(def failures (atom []))
(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 942))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rchoice [coll] (nth coll (rint (count coll))))
(defn- rid [prefix] (str prefix (rint 1000000)))

(def ^:private gate-choices ["mutation" "CRAP"])
(def ^:private segment-chars "abcdefghijklmnopqrstuvwxyz0123456789")
(defn- rsegment [len]
  (apply str (repeatedly len #(nth segment-chars (rint (count segment-chars))))))
(defn- rfile [] (str (rsegment (+ 2 (rint 8))) "/" (rsegment (+ 2 (rint 8))) ".ts"))
(defn- rfile-set [n] (vec (repeatedly n rfile)))
(defn- shuffle-with [rand-fn coll]
  ;; deterministic Fisher-Yates using the seeded rng, not clojure.core/shuffle
  ;; (which uses its own unseeded generator and would break reproducibility)
  (let [v (vec coll)
        n (count v)]
    (loop [v v i (dec n)]
      (if (<= i 0)
        v
        (let [j (rand-fn (inc i))]
          (recur (assoc v i (nth v j) j (nth v i)) (dec i)))))))

;; ── P1: deferred-vs-ran-are-never-indistinguishable (invariant 1) ─────────

(def p1-trials 300)
(def ^:private p1-reached-multi-redelivery (atom false))

(dotimes [trial p1-trials]
  (let [n-deferred (inc (rint 4))
        n-ran (inc (rint 4))
        deferred-requests (vec (for [_ (range n-deferred)]
                                  {:parcel (rid "BL-D") :gate (rchoice gate-choices)
                                   :file-set (rfile-set (inc (rint 3)))
                                   :reason "host load above busy threshold"
                                   :load (str (+ 10 (rint 90)) "/" (+ 5 (rint 80)) "/" (+ 2 (rint 70)))
                                   :detected-at "2026-08-19"}))
        ran-parcels (vec (repeatedly n-ran #(rid "BL-R")))
        rows (reduce (fn [rows req]
                       (let [repeats (inc (rint 3))]
                         (when (> repeats 1) (reset! p1-reached-multi-redelivery true))
                         (reduce (fn [rs _] (hdl/record-deferral rs req)) rows (range repeats))))
                     []
                     deferred-requests)
        outstanding (hdl/outstanding-debt rows)
        outstanding-parcels (set (map :parcel outstanding))]
    (doseq [req deferred-requests]
      (assert-true (str "P1 trial " trial ": deferred parcel " (:parcel req) " is named in outstanding debt")
                   (contains? outstanding-parcels (:parcel req))))
    (doseq [ran ran-parcels]
      (assert-true (str "P1 trial " trial ": a RAN parcel (" ran ") that was never deferred has no row")
                   (not (contains? outstanding-parcels ran))))
    (assert-true (str "P1 trial " trial ": redelivering the same defer request never grows the row count past one per request")
                 (<= (count rows) (count deferred-requests)))))

(assert-true "P1 generator reached a multi-redelivery case (same request recorded more than once)"
             @p1-reached-multi-redelivery)

;; ── P2: file-set-fidelity-no-cross-parcel-bleed (invariant 2) ─────────────

(def p2-trials 300)

(dotimes [trial p2-trials]
  (let [pool (vec (distinct (repeatedly 20 rfile)))
        split (+ 2 (rint (- (count pool) 4)))
        set-a (subvec pool 0 split)
        set-b (subvec pool split (count pool))
        gate (rchoice gate-choices)
        ;; duplicate + whitespace-noise + shuffle each parcel's OWN input,
        ;; but never let the two parcels' inputs overlap
        noisy (fn [files]
                (shuffle-with #(rint %)
                              (concat files
                                      (when (pos? (count files)) [(str " " (first files) " ")]))))
        req-a {:parcel (rid "BL-A") :gate gate :file-set (noisy set-a)
               :reason "host load above busy threshold" :load "70/60/50" :detected-at "2026-08-19"}
        req-b {:parcel (rid "BL-B") :gate gate :file-set (noisy set-b)
               :reason "host load above busy threshold" :load "70/60/50" :detected-at "2026-08-19"}
        rows (-> [] (hdl/record-deferral req-a) (hdl/record-deferral req-b))
        row-a (first (hdl/rows-for-parcel rows (:parcel req-a)))
        row-b (first (hdl/rows-for-parcel rows (:parcel req-b)))]
    (assert-true (str "P2 trial " trial ": parcel A's row exists") (some? row-a))
    (assert-true (str "P2 trial " trial ": parcel B's row exists") (some? row-b))
    (when (and row-a row-b)
      (assert-true (str "P2 trial " trial ": parcel A's file-set equals exactly its own normalized input")
                   (= (hdl/normalize-file-set set-a) (:file-set row-a)))
      (assert-true (str "P2 trial " trial ": parcel B's file-set equals exactly its own normalized input")
                   (= (hdl/normalize-file-set set-b) (:file-set row-b)))
      (assert-true (str "P2 trial " trial ": parcel A's file-set never contains one of B's files")
                   (empty? (clojure.set/intersection (set (:file-set row-a)) (set set-b))))
      (assert-true (str "P2 trial " trial ": parcel B's file-set never contains one of A's files")
                   (empty? (clojure.set/intersection (set (:file-set row-b)) (set set-a)))))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "bl942_hardening_debt_ledger_property_runner: ok")
