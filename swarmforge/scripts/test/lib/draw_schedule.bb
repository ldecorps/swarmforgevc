#!/usr/bin/env bb
;; BL-1559: the bl983 runner's seat/parcel draw plan, constructed so every
;; reach floor is met BY CONSTRUCTION on every run - never by a uniform draw
;; the floor merely hopes will cover it (BL-1062's rule, same FIRM line as
;; BL-1555).
;;
;; `seat-schedule` returns nine quota-cell plans - four two-seat plans whose
;; parcel count (2 or 3) also makes them all-busy plans, two more two-seat
;; plans, and three three-seat plans - meeting two-seat >= 6, three-seat >=
;; 3 and all-busy >= 4 by construction, then fills the remaining
;; `runs - 9` plans (for `runs` >= 9) from a uniform draw identical in shape
;; to the runner's own (n-seats a fair 2-or-3 coin, n-parcels uniform in
;; 1..n-seats+1), and finally shuffles the whole vector with `rng` so the
;; interleaving of pack shapes across draws stays random. Below 9 runs the
;; nine quota cells cannot all fit, so every plan is drawn uniformly instead
;; and the runner's absolute floors fail as they do today - not a defect
;; (BL-1559 ticket, "Below 9 draws" note).

(ns draw-schedule-lib)

(defn- rand-int-rng [rng n] (.nextInt rng n))

(defn- uniform-plan [rng]
  (let [n-seats (+ 2 (rand-int-rng rng 2))
        n-parcels (inc (rand-int-rng rng (inc n-seats)))]
    {:n-seats n-seats :n-parcels n-parcels}))

(defn- quota-cells [rng]
  (concat
   ;; four two-seat plans whose parcel count (2 or 3) is also >= n-seats,
   ;; so each is both a two-seat AND an all-busy cell.
   (for [i (range 4)] {:n-seats 2 :n-parcels (if (even? i) 2 3)})
   ;; two more two-seat plans, filling the two-seat quota to six.
   (repeatedly 2 #(hash-map :n-seats 2 :n-parcels (inc (rand-int-rng rng 3))))
   ;; three three-seat plans, meeting the three-seat quota.
   (repeatedly 3 #(hash-map :n-seats 3 :n-parcels (inc (rand-int-rng rng 4))))))

(defn- shuffle-with [rng xs]
  (let [al (java.util.ArrayList. xs)]
    (java.util.Collections/shuffle al rng)
    (vec al)))

(defn seat-schedule
  "Returns a vector of `runs` draw plans, each {:n-seats 2|3 :n-parcels k}
   with k in 1..n-seats+1, in an order shuffled with `rng`. For any `runs`
   >= 9 the vector holds at least six :n-seats 2 plans, at least three
   :n-seats 3 plans, and at least four plans with :n-parcels >= :n-seats
   (all-busy), every time, by construction. Below 9, every plan is drawn
   uniformly and the quotas are not guaranteed."
  [runs rng]
  (let [cells (if (>= runs 9)
                (let [quota (vec (quota-cells rng))
                      n-fill (- runs (count quota))]
                  (into quota (repeatedly n-fill #(uniform-plan rng))))
                (vec (repeatedly runs #(uniform-plan rng))))]
    (shuffle-with rng cells)))
