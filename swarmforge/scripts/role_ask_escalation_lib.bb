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

