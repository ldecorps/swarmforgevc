#!/usr/bin/env bb
;; BL-1154: thin JSON adapter for front_desk_supervisor_lib/check-one!.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))

(def scenario (json/parse-string (nth *command-line-args* 0) true))

(defn ->entry [e]
  {:pid (:pid e)
   :attempts (:attempts e)
   :status (:status e)
   :crashed-at-ms (or (:crashedAtMs e) (:crashed-at-ms e))
   :started-at-ms (or (:startedAtMs e) (:started-at-ms e))
   :gave-up-at-ms (or (:gaveUpAtMs e) (:gave-up-at-ms e))
   :build-stale-since-ms (or (:buildStaleSinceMs e) (:build-stale-since-ms e))})

(defn ->entry-json [e]
  {:pid (:pid e)
   :attempts (:attempts e)
   :status (:status e)
   :crashedAtMs (:crashed-at-ms e)
   :startedAtMs (:started-at-ms e)
   :gaveUpAtMs (:gave-up-at-ms e)
   :buildStaleSinceMs (:build-stale-since-ms e)})

(def entry (->entry (:entry scenario)))
(def now-ms (:nowMs scenario))
(def pid-alive? (constantly (boolean (:pidAlive scenario))))
(def next-pid (atom 9000))
(def spawn! (fn [] (swap! next-pid inc)))
(def restart-config
  (merge {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000 :healthy-reset-ms 600000 :build-grace-ms 300000}
         (when-let [c (:restartConfig scenario)]
           {:max-attempts (:maxAttempts c)
            :backoff-base-ms (:backoffBaseMs c)
            :backoff-max-ms (:backoffMaxMs c)
            :healthy-reset-ms (:healthyResetMs c)
            :build-grace-ms (:buildGraceMs c)})))
(def giveup-config
  (merge {:giveup-cooldown-ms 900000}
         (when-let [c (:giveupConfig scenario)]
           {:giveup-cooldown-ms (:giveupCooldownMs c)})))

(def result
  (front-desk-supervisor-lib/check-one!
   entry now-ms pid-alive? spawn! restart-config giveup-config
   false (fn [_] nil)
   (boolean (if (contains? scenario :buildStale) (:buildStale scenario) false))
   (boolean (if (contains? scenario :buildServed) (:buildServed scenario) true))))

(println (json/generate-string {:entry (->entry-json (:entry result))
                                :event (some-> (:event result) name)}))
