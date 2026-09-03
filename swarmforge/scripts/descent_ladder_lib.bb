#!/usr/bin/env bb
;; BL-1327: the scheduled descent ladder's PURE decision - walk a
;; well-performing seat down through effort notches before model notches, one
;; notch per review period, with asymmetric hysteresis.
;;
;; Slice 1 is PROPOSAL-ONLY by the human's 2026-09-02 ruling: this namespace
;; computes what SHOULD be tried next and nothing here can apply it. There is
;; deliberately no apply verb to call by accident - the governance boundary the
;; epic and BL-1056 both draw ("no autonomous seat mutation") is enforced by
;; the shape of this API, not by a comment asking callers to behave.
;;
;; The ladder itself is BL-1317's, not a second representation: the effort
;; rungs come from seat_difficulty_lib's adapt-effort-ladder, so a seat cannot
;; be walked onto a rung the climb half has never heard of (BL-897).

(ns descent-ladder-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "seat_difficulty_lib.bb")))

(def effort-ladder
  "Weakest first, from BL-1317's own ladder - never restated here."
  seat-difficulty-lib/adapt-effort-ladder)

(def ^:private smaller-model-start-effort
  "A cheaper model starts at HIGH, never at low: a smaller brain may need MORE
   deliberation, so descending the model ladder and the effort ladder at the
   same time would confound two changes in one notch and could not be read."
  "high")

(defn- effort-rank [effort]
  (let [e (some-> effort str str/trim str/lower-case)]
    (first (keep-indexed (fn [i r] (when (= r e) i)) effort-ladder))))

(defn- next-lower-effort [effort]
  (let [i (effort-rank effort)]
    (when (and i (pos? i))
      (nth effort-ladder (dec i)))))

(defn- next-cheaper-model
  "The model after the current one on the ladder, which is ordered
   most-expensive first. nil at the bottom."
  [model ladder]
  (let [i (first (keep-indexed (fn [i m] (when (= m model) i)) ladder))]
    (when (and i (< (inc i) (count ladder)))
      (nth ladder (inc i)))))

(defn descent-decision
  "What the scheduled review should PROPOSE for one seat, given its ladder
   position and its guard window.

   {:propose? false :reason \"...\"} - nothing to try, and it always says why,
   because a review that goes quiet is indistinguishable from one that did not
   run. {:propose? true :proposal {...}} otherwise; the proposal names the
   seat, the notch to try, where it came from, and its reason.

   The three declared invariants live here:

   1. A notch is proposed only after :clean-periods has reached
      :required-clean-periods at the CURRENT notch. One clean period never
      moves a seat - descents need the whole streak while a climb takes one
      signal (BL-1317), which is the asymmetry the epic asks for.
   2. A guard trip proposes nothing at all this period; returning ladder state
      to the last known-good notch is `record-guard-trip` below, and happens
      whatever the ruling on auto-apply.
   3. Effort is exhausted before a model is ever proposed: while the current
      model still has a lower effort rung, that rung is the proposal."
  [{:keys [seat current-effort current-model model-ladder clean-periods
           required-clean-periods guard-tripped? price-window-shifted?]}]
  (let [needed (or required-clean-periods 3)
        streak (or clean-periods 0)
        lower-effort (next-lower-effort current-effort)
        cheaper-model (next-cheaper-model current-model model-ladder)]
    (cond
      guard-tripped?
      {:propose? false
       :reason "guard tripped this period - the ladder climbs back rather than descending"}

      (< streak needed)
      {:propose? false
       :reason (str "clean streak " streak "/" needed " at the current notch")}

      lower-effort
      {:propose? true
       :proposal {:seat seat
                  :effort lower-effort
                  :model current-model
                  :from {:effort current-effort :model current-model}
                  :applied? false
                  :reason (str "guard-clean for " streak " review periods at "
                               current-effort " on " current-model
                               " - try one effort notch lower before any model change")}}

      cheaper-model
      {:propose? true
       :proposal {:seat seat
                  :effort smaller-model-start-effort
                  :model cheaper-model
                  :from {:effort current-effort :model current-model}
                  :applied? false
                  :reason (str "effort notches exhausted on " current-model
                               " while guard-clean - try " cheaper-model " at "
                               smaller-model-start-effort " effort, not at "
                               (first effort-ladder)
                               ", because a smaller model may need MORE deliberation"
                               (when price-window-shifted?
                                 " (re-walked because the price window shifted)"))}}

      :else
      {:propose? false
       :reason (str "terminal notch: " current-effort " on " current-model
                    " is the bottom of both ladders"
                    (when price-window-shifted?
                      " - the price window shifted but offers nothing cheaper"))})))

(defn record-guard-trip
  "Invariant 2. A guard trip discards any partial clean-period progress and
   returns ladder state to the last known-good notch immediately - regardless
   of the ruling on auto-apply, because this is ladder BOOKKEEPING, not a seat
   mutation. With no known-good notch recorded there is nowhere to climb back
   to, so the seat stays where it is and only the progress is discarded: an
   invented notch would be a mutation this slice may not make."
  [{:keys [effort model last-known-good] :as state}]
  (merge state
         {:clean-periods 0
          :effort (or (:effort last-known-good) effort)
          :model (or (:model last-known-good) model)
          :reason (if last-known-good
                    (str "guard trip - climbed back to the last known-good notch "
                         (:effort last-known-good) " on " (:model last-known-good)
                         ", clean-period progress discarded")
                    "guard trip - no known-good notch recorded, clean-period progress discarded")}))
