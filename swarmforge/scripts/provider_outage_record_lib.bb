#!/usr/bin/env bb
;; BL-669 / BL-650: pure provider-outage record shapes and sustained-outage
;; predicates. IO lives in outage_failover_store.bb.
(ns provider-outage-record-lib
  (:require [clojure.string :as str]))

(def default-sustained-threshold-ms (* 20 60 1000))

(defn normalize-record
  "Coerce a parsed JSON map into the outage record contract BL-669 expects."
  [m]
  (when (map? m)
    {:id (or (:id m) (str (:provider m) "/" (:model m) "/" (:started-at-ms m)))
     :provider (:provider m)
     :model (:model m)
     :affected-seats (vec (or (:affected-seats m) (:affectedSeats m) []))
     :started-at-ms (long (or (:started-at-ms m) (:startedAtMs m) 0))
     :ended-at-utc (or (:ended-at-utc m) (:endedAtUtc m))}))

(defn outage-open? [record]
  (and record (nil? (:ended-at-utc record))))

(defn outage-duration-ms [record now-ms]
  (max 0 (- now-ms (:started-at-ms record))))

(defn sustained?
  ([record now-ms] (sustained? record now-ms default-sustained-threshold-ms))
  ([record now-ms threshold-ms]
   (and (outage-open? record)
        (>= (outage-duration-ms record now-ms) threshold-ms))))

(defn affects-seat? [record seat]
  (boolean (some #(= seat %) (:affected-seats record))))

(defn sustained-for-seat
  ([records seat now-ms]
   (sustained-for-seat records seat now-ms default-sustained-threshold-ms))
  ([records seat now-ms threshold-ms]
   (->> records
        (keep normalize-record)
        (filter #(and (affects-seat? % seat) (sustained? % now-ms threshold-ms)))
        vec)))

(defn closed-records-for-seat [records seat]
  (->> records
       (keep normalize-record)
       (filter #(and (affects-seat? % seat) (some? (:ended-at-utc %))))
       vec))
