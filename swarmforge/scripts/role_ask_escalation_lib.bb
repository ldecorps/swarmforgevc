#!/usr/bin/env bb
;; GH-25: pure decisions for unanswered role_ask escalation (GitHub mention
;; transport). Impure post/stamp/tick wiring lives in operator_runtime.bb.
(ns role-ask-escalation-lib
  (:require [clojure.string :as str]))

(def default-threshold-minutes 30)
(def mention-handle "@ldecorps")

(defn parse-threshold-minutes
  "Positive integer minutes from env/conf text; anything else → default 30."
  [raw]
  (let [n (when (and raw (re-matches #"\d+" (str/trim (str raw))))
            (Long/parseLong (str/trim (str raw))))]
    (if (and n (pos? n)) n default-threshold-minutes)))

(defn threshold-ms
  [minutes]
  (* (long (or minutes default-threshold-minutes)) 60 1000))

(defn escalation-due?
  "True when asked_at_ms is known, no escalated_at_ms yet, and age ≥ threshold."
  [{:keys [asked_at_ms escalated_at_ms]} now-ms thresh-ms]
  (boolean
   (and asked_at_ms
        (nil? escalated_at_ms)
        (number? now-ms)
        (number? thresh-ms)
        (>= (- now-ms asked_at_ms) thresh-ms))))

(defn decide-escalation-outcome
  "Pure: :posted-and-stamped when due, else :none (under age or already stamped)."
  [marker now-ms thresh-ms]
  (if (escalation-due? marker now-ms thresh-ms)
    :posted-and-stamped
    :none))

(defn stamp-escalated
  [marker now-ms]
  (assoc marker :escalated_at_ms now-ms))

(defn format-mention-body
  [role question]
  (str mention-handle
       " unanswered role question from `" (or role "?") "`"
       " (GH-25 escalation):\n\n"
       (or question "(no question text)")))

(defn question-surface-state
  "escalated only after escalated_at_ms is stamped; else pending."
  [{:keys [escalated_at_ms]} _now-ms _thresh-ms]
  (if escalated_at_ms "escalated" "pending"))

(defn render-role-questions
  "Map role → {:question :asked_at_ms :state :escalated_at_ms?} for status.json.
   Omits empty/unreadable markers."
  [markers now-ms thresh-ms]
  (into {}
        (keep (fn [[role marker]]
                (when (and (map? marker) (:asked_at_ms marker))
                  [role (cond-> {:question (:question marker)
                                 :asked_at_ms (:asked_at_ms marker)
                                 :state (question-surface-state marker now-ms thresh-ms)}
                          (:escalated_at_ms marker)
                          (assoc :escalated_at_ms (:escalated_at_ms marker)))])))
        markers))

(defn parse-ops-issue
  "Digits-only issue number string, or nil when missing/malformed."
  [raw]
  (let [s (some-> raw str str/trim)]
    (when (and s (re-matches #"\d+" s)) s)))

;; ── BL-1352: the transport's own visibility ──────────────────────────────
;; GH-25 chose "a missing ops issue degrades to a status key and a log line
;; rather than crashing", which is right about the crash and wrong about the
;; safety signal: nothing read the key, the line was emitted once per tick
;; forever (7027 of them), and two role slots sat wedged for four days while
;; the escalation quietly could not deliver. These two functions are what make
;; that shape impossible - a state a human surface can read, and a log that
;; speaks on change instead of on every tick.

(defn escalation-transport-state
  "The state the human status surface shows for the ask escalation.

   :ok                 the transport can deliver (whether or not anything is
                       waiting)
   :warn-unconfigured  it cannot deliver, but nothing is waiting - worth
                       saying, not worth a red. A signal that is permanently
                       on stops being read, which is how the last one died.
   :fault              it cannot deliver AND a question is past the threshold:
                       something is being lost right now.

   The detail names every waiting role, not just the first: the operator needs
   to know whose question is going undelivered, and a fault that names one of
   two is a fault that gets half-fixed."
  [{:keys [transport waiting-roles]}]
  (let [waiting (vec (remove str/blank? (map str (or waiting-roles []))))
        configured? (= :configured (keyword (name (or transport :unconfigured))))]
    (cond
      configured?
      {:state :ok
       :detail (if (seq waiting)
                 (str "transport configured; " (count waiting) " question(s) awaiting escalation: "
                      (str/join ", " (sort waiting)))
                 "transport configured; no question awaiting escalation")}

      (seq waiting)
      {:state :fault
       :detail (str "transport unconfigured while " (str/join ", " (sort waiting))
                    " " (if (= 1 (count waiting)) "is" "are")
                    " past the escalation threshold - the question is not being delivered")}

      :else
      {:state :warn-unconfigured
       :detail "transport unconfigured; nothing is waiting, so nothing is being lost yet"})))

(defn transport-log-due?
  "True when the transport state should be written to the operator log: on the
   first observation, and thereafter only when it CHANGES. Ten ticks in one
   state produce one line, which is the whole of invariant 2 - a log flooded
   past usefulness is a log nobody reads, and that is how 7027 identical
   refusals went unnoticed.

   `last` is the persisted record (its :state a string, having been through
   JSON); `current` is this tick's freshly-computed state."
  [last current]
  (not= (some-> last :state str) (some-> current :state name)))

