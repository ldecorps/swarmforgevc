;; BL-784: shared per-tick log heartbeat for long-running loop supervisors.
;; daemon_log_freshness_check.sh treats a timestamped "heartbeat" line as
;; liveness — quiet ticks must still write one.
(ns daemon-log-freshness-pulse-lib
  (:require [babashka.fs :as fs]))

(defn iso-now []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn append-log-heartbeat!
  "Append one ISO timestamp heartbeat line to the supervisor log. Pure path
   handling aside from the append itself."
  [log-path]
  (when log-path
    (let [parent (fs/parent log-path)]
      (when parent (fs/create-dirs parent))
      (spit (str log-path) (str (iso-now) " heartbeat\n") :append true))))
