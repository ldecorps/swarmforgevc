#!/usr/bin/env bb
;; BL-597: append-only self-heal telemetry for behaviour trends.
;; One JSON line per recovery action — type, subject, reason, at.
;; Loaded via load-file; refer as self-heal-telemetry-lib/foo.

(ns self-heal-telemetry-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def store-dir-rel ".swarmforge/telemetry")

(def ^:private ym-formatter
  (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM"))

(def ^:private instant-formatter
  (java.time.format.DateTimeFormatter/ISO_INSTANT))

(defn self-heal-telemetry-file
  ([root] (self-heal-telemetry-file root (System/currentTimeMillis)))
  ([root at-ms]
   (let [ym (.format ym-formatter
                     (.atZone (java.time.Instant/ofEpochMilli at-ms)
                              java.time.ZoneOffset/UTC))]
     (fs/path root store-dir-rel (str "self-heal-" ym ".jsonl")))))

(defn normalize-event
  [{:keys [type subject reason at]}]
  (when (and (seq (str/trim (or type "")))
             (seq (str/trim (or subject "")))
             (seq (str/trim (or at ""))))
    {:type (str/trim type)
     :subject (str/trim subject)
     :reason (str/trim (or reason ""))
     :at (str/trim at)}))

(defn append-self-heal-event!
  "Append exactly one self-heal line. Failures are swallowed — measuring
   must never block or alter recovery."
  [root {:keys [type subject reason at-ms]}]
  (try
    (when-let [typ (not-empty (str/trim (or type "")))]
      (let [at-ms (or at-ms (System/currentTimeMillis))
            at (.format instant-formatter (java.time.Instant/ofEpochMilli at-ms))
            line (json/generate-string
                  {:type typ
                   :subject (or (not-empty (str/trim (or subject ""))) "unknown")
                   :reason (str/trim (or reason ""))
                   :at at})
            file (self-heal-telemetry-file root at-ms)]
        (fs/create-dirs (fs/parent file))
        (spit (str file) (str line "\n") :append true)))
    (catch Exception _ nil)))
