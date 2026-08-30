#!/usr/bin/env bb
;; BL-670 invariant 1, coder-authored (BL-654): "A ticket any stage has touched
;; always carries its stage QUALIFIED: one of claimed | in-transit-to |
;; last-known, plus an as-of time. A bare role with no status and no as-of is
;; not a satisfied derivation."
;;
;; In the Babashka property lane because the derivation is Babashka: the two
;; consumer-side invariants are TypeScript and live in
;; extension/test/bl670StageQualifierInvariants.property.test.js.
;;
;; Deterministic by construction: a seeded LCG, never rand. Every failure
;; prints its seed and its input.
;;
;; GENERATOR REACH, stated because it decides whether this proves anything:
;;   - the ROLE alphabet is deliberately tiny (three roles), so the same ticket
;;     being observed at two roles at once - the collision the reconciler
;;     exists for - happens constantly rather than once in a blue moon. A wide
;;     alphabet would make every draw a trivial single-observation case;
;;     - the TICKET alphabet is two ids, for the same reason;
;;   - every status carries its own reach floor, and so does the multi-
;;     observation case, because a run that only ever saw one observation per
;;     ticket would say nothing about reconciliation at all.
;;
;; Non-vacuity is proven by breaking the invariant and recording the result -
;; see backlog/evidence/BL-670-last-known-stage-and-health-20260830.md.

(ns bl670-stage-qualifier-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "pipeline_stage_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))
(def coverage (atom {}))

(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(def role-order ["specifier" "coder" "cleaner"])
(def tickets ["BL-1" "BL-2"])
(def statuses ["claimed" "in-transit-to" "last-known"])
(def known-statuses (set statuses))

(defn gen-observation [s]
  (let [[role s0] (gen-pick s role-order)
        [ticket s1] (gen-pick s0 tickets)
        [status s2] (gen-pick s1 statuses)
        [tick s3] (gen-int s2 100)]
    [{:role role :ticket-id ticket :status status
      :as-of (format "2026-08-30T00:%02d:00Z" tick)}
     s3]))

(defn gen-observations [s]
  (let [[n s0] (gen-int s 5)]
    (loop [i 0 s' s0 acc []]
      (if (>= i (inc n))
        [acc s']
        (let [[obs s''] (gen-observation s')]
          (recur (inc i) s'' (conj acc obs)))))))

(check-all
 "P1: every derived entry is qualified with a known status and an as-of"
 gen-observations
 (fn [observations]
   (let [derived (pipeline-stage-lib/reconcile-stage-entries observations role-order)
         observed-tickets (set (map :ticket-id observations))]
     (doseq [o observations] (cover! (keyword (:status o))))
     (when (> (count observations) 1) (cover! :multi))
     (when (< (count (set (map :ticket-id observations))) (count observations)) (cover! :collision))
     (cond
       ;; Every ticket ANY observation touched must be in the map: the board
       ;; going blind on a ticket the trail knows about is the whole defect.
       (not= observed-tickets (set (keys derived)))
       (str "derived tickets " (pr-str (set (keys derived)))
            " do not match observed " (pr-str observed-tickets))

       (some (fn [[_ e]] (not (contains? known-statuses (:status e)))) derived)
       (str "an entry carries a status outside the three: " (pr-str derived))

       (some (fn [[_ e]] (str/blank? (str (:stage e)))) derived)
       (str "an entry carries no stage: " (pr-str derived))

       ;; The bare-role shape is exactly what invariant 1 says is NOT a
       ;; satisfied derivation.
       (some (fn [[_ e]] (str/blank? (str (:asOf e)))) derived)
       (str "an entry carries no as-of time: " (pr-str derived))

       ;; Whatever it says must be something it was actually told.
       (some (fn [[t e]]
               (not (some (fn [o] (and (= t (:ticket-id o))
                                       (= (:stage e) (:role o))
                                       (= (:status e) (:status o))
                                       (= (:asOf e) (:as-of o))))
                          observations)))
             derived)
       (str "an entry was invented rather than chosen from the observations: " (pr-str derived))

       :else true))))

(check-all
 "P2: reconciliation is order-independent - one row per ticket, whatever the input order"
 gen-observations
 (fn [observations]
   (let [forward (pipeline-stage-lib/reconcile-stage-entries observations role-order)
         backward (pipeline-stage-lib/reconcile-stage-entries (reverse observations) role-order)]
     (when (seq observations) (cover! :ordered))
     (cond
       (not= forward backward)
       (str "the same observations reconciled differently by order:\n  " (pr-str forward) "\n  " (pr-str backward))
       :else true))))

(check-all
 "P3: a trail entry never displaces a live one for the same ticket"
 gen-observations
 (fn [observations]
   (let [derived (pipeline-stage-lib/reconcile-stage-entries observations role-order)
         live-tickets (set (map :ticket-id (filter #(contains? pipeline-stage-lib/live-statuses (:status %)) observations)))]
     (when (seq live-tickets) (cover! :has-live))
     (if-let [bad (some (fn [t] (when (= "last-known" (:status (get derived t))) t)) live-tickets)]
       (str "ticket " bad " has a live observation but derived last-known: " (pr-str derived))
       true))))

(def floors {:claimed 200 :in-transit-to 200 :last-known 200
             :multi 300 :collision 200 :ordered 400 :has-live 300})

(doseq [[k floor] floors]
  (let [drawn (get @coverage k 0)]
    (when (< drawn floor)
      (swap! failures conj (str "FAIL reach floor: " (name k) " drawn " drawn " < " floor)))))

(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str @coverage) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
