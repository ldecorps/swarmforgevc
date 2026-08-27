#!/usr/bin/env bb
;; expedite_announce_lib.bb — BL-656: format compact Operator-topic ride-log lines.
;; Pure decisions only; IO lives in expedite_cli.bb and notify-expedite-milestone.ts.

(ns expedite-announce-lib
  (:require [clojure.string :as str]))

;; Same discipline as coordinator/handoff notes (dispatch-gap-note-max-length).
(def reason-max-length 80)

(defn- truncate-text [s max-len]
  (let [s (str s)]
    (if (<= (count s) max-len) s (str (subs s 0 (max 0 (- max-len 1))) "…"))))

(defn truncate-reason-with-evidence
  "Truncate a bounce reason but keep an evidence path pointer when present."
  [reason evidence-path]
  (let [reason (str (or reason ""))
        path (some-> evidence-path str str/trim not-empty)]
    (if path
      (let [suffix (str " " path)
            max-reason (- reason-max-length (count suffix) 1)]
        (if (<= (count reason) max-reason)
          (str reason suffix)
          (str (truncate-text reason max-reason) suffix)))
      (truncate-text reason reason-max-length))))

(defn- verdict-label [verdict round]
  (let [v (keyword verdict)]
    (cond
      (= v :bounce) (str "SEND BACK #" (or round 1))
      (contains? #{:send-back :sendback} v) (str "SEND BACK #" (or round 1))
      (= v :pass) "PASS"
      (= v :forward) "FORWARD"
      (= v :approved) "APPROVED"
      (keyword? v) (str/upper-case (name v))
      :else (str verdict))))

(defn format-initiation-ok [{:keys [ticket was-live?]}]
  (str "🚑 " ticket ": initiation OK"
       (when was-live? " (swarm was live, stopped)")))

(defn format-initiation-refuse [{:keys [ticket survivors reason]}]
  (let [alive (not-empty (map str survivors))
        prefix (str "🚑 " ticket ": REFUSE initiation")]
    (str prefix
         (when alive (str " — survivors " (str/join "," alive)))
         (when (seq (str reason)) (str " — " reason)))))

(defn format-park [{:keys [ticket parked destination]}]
  (str "🚑 " ticket ": park " (str/join "," parked) " -> backlog/" destination "/"))

(defn format-stage-entered [{:keys [ticket stage idx total]}]
  (str "🚑 " ticket ": stage " stage " entered (" idx "/" total ")"))

(defn format-stage-verdict
  [{:keys [ticket stage verdict round reason evidence-path]}]
  (let [head (str "🚑 " ticket " " stage ": " (verdict-label verdict round))
        body (truncate-reason-with-evidence reason evidence-path)]
    (if (str/blank? body) head (str head " — " body))))

(defn format-final-verdict [{:keys [ticket outcome]}]
  (str "🚑 " ticket ": final " (name outcome)))

(defn format-restart [{:keys [ticket outcome]}]
  (str "🚑 " ticket ": restart " (name outcome)))

(defn format-milestone
  "Render one announce line for kind (:initiation-ok :initiation-refuse :park
   :stage-entered :stage-verdict :final-verdict :restart)."
  [{:keys [kind ticket] :as m}]
  (when (and kind ticket)
    (case kind
      :initiation-ok (format-initiation-ok m)
      :initiation-refuse (format-initiation-refuse m)
      :park (format-park m)
      :stage-entered (format-stage-entered m)
      :stage-verdict (format-stage-verdict m)
      :final-verdict (format-final-verdict m)
      :restart (format-restart m)
      nil)))
