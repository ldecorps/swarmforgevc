#!/usr/bin/env bb
;; BL-596: append-only rotation telemetry for mono-router dynamics trends.
;; One JSON line per successful rotate-resident-to! — from, to, reason, at.
;; Loaded via load-file; refer as rotation-telemetry-lib/foo.

(ns rotation-telemetry-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def store-dir-rel ".swarmforge/telemetry")
(def default-reason "rotate")

(def ^:private ym-formatter
  (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM"))

(def ^:private instant-formatter
  (java.time.format.DateTimeFormatter/ISO_INSTANT))

(defn rotation-telemetry-file
  "`.swarmforge/telemetry/rotation-YYYY-MM.jsonl` under root."
  ([root] (rotation-telemetry-file root (System/currentTimeMillis)))
  ([root at-ms]
   (let [ym (.format ym-formatter
                     (.atZone (java.time.Instant/ofEpochMilli at-ms)
                              java.time.ZoneOffset/UTC))]
     (fs/path root store-dir-rel (str "rotation-" ym ".jsonl")))))

(defn normalize-event
  "Pure shape check for one rotation record."
  [{:keys [from to reason at]}]
  (when (and (seq (str/trim (or from "")))
             (seq (str/trim (or to "")))
             (seq (str/trim (or at ""))))
    {:from (str/trim from)
     :to (str/trim to)
     :reason (str/trim (or reason default-reason))
     :at (str/trim at)}))

(defn append-rotation-event!
  "Append exactly one rotation line. Failures are swallowed — observability
   must never block rotation."
  [root {:keys [from to reason at-ms]}]
  (try
    (when-let [to-role (not-empty (str/trim (or to "")))]
      (let [from-role (or (not-empty (str/trim (or from ""))) "unknown")
            at-ms (or at-ms (System/currentTimeMillis))
            at (.format instant-formatter (java.time.Instant/ofEpochMilli at-ms))
            line (json/generate-string
                  {:from from-role :to to-role
                   :reason (or (not-empty (str/trim (or reason ""))) default-reason)
                   :at at})
            file (rotation-telemetry-file root at-ms)]
        (fs/create-dirs (fs/parent file))
        (spit (str file) (str line "\n") :append true)))
    (catch Exception _ nil)))
