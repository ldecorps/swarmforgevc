#!/usr/bin/env bb
;; BL-660: pure shift-pack schedule — one active swarm_shift drives every
;; schedule-derived clock. No I/O; mirrors cooldownWindowCore.ts posture.

(ns swarm-shift-lib
  (:require [clojure.string :as str]))

(def shift-names #{"day" "evening" "night"})

(def shift-definitions
  {"day"     {:start [9 0] :stop [17 0]}
   "evening" {:start [17 0] :stop [1 0]}
   "night"   {:start [1 0] :stop [9 0]}})

(def default-outage-credit-cap-minutes 120)

(defn- parse-hhmm [s]
  (when-let [[_ h m] (re-matches #"^(\d{1,2}):(\d{2})$" (str/trim (or s "")))]
    (let [hour (Integer/parseInt h)
          minute (Integer/parseInt m)]
      (when (and (<= 0 hour 23) (<= 0 minute 59))
        [hour minute]))))

(defn format-hhmm [[hour minute]]
  (format "%02d:%02d" (int hour) (int minute)))

(defn raw-swarm-shift [conf-text]
  (some->> (str/split-lines (or conf-text ""))
           (filter #(str/starts-with? % "config swarm_shift "))
           first
           (re-find #"^config\s+swarm_shift\s+(\S+)")
           second
           str/trim
           not-empty))

(defn parse-swarm-shift
  "Returns shift name string, or nil when absent/blank/unknown."
  [conf-text]
  (let [raw (raw-swarm-shift conf-text)]
    (when (contains? shift-names raw) raw)))

(defn shift-times [shift-name]
  (get shift-definitions shift-name))

(defn resolve-schedule
  "When swarm_shift is active, every derived clock comes from this map.
   When absent, returns nil (callers keep today's independent keys)."
  [conf-text]
  (when-let [shift (parse-swarm-shift conf-text)]
    (let [{:keys [start stop]} (shift-times shift)
          start-local (format-hhmm start)
          stop-local (format-hhmm stop)]
      {:shift shift
       :start-local start-local
       :stop-local stop-local
       :closure-stop-local stop-local
       :cooldown-window-enabled true
       :cooldown-start-local stop-local
       :cooldown-end-local start-local})))

(defn minutes-of-day [[h m]]
  (+ (* (int h) 60) (int m)))

(defn within-shift-minutes?
  [now-minutes [sh sm] [eh em]]
  (let [start (minutes-of-day [sh sm])
        end (minutes-of-day [eh em])]
    (if (< start end)
      (and (>= now-minutes start) (< now-minutes end))
      (or (>= now-minutes start) (< now-minutes end)))))

(defn- weekday-index [d]
  (get {"Monday" 0 "Tuesday" 1 "Wednesday" 2 "Thursday" 3 "Friday" 4 "Saturday" 5 "Sunday" 6} d 0))

(defn- index-weekday [i]
  (get ["Monday" "Tuesday" "Wednesday" "Thursday" "Friday" "Saturday" "Sunday"]
       (mod i 7)))

(defn- prev-weekday [d]
  (index-weekday (dec (weekday-index d))))

(defn- next-weekday [d]
  (index-weekday (inc (weekday-index d))))

(defn running-shift-continues?
  "Shift change while running: current shift continues until its stop boundary."
  [{:keys [running-shift requested-shift]}]
  (boolean (and running-shift requested-shift (not= running-shift requested-shift))))

(defn calendar-anchor
  "For evening spanning midnight: given anchor local date-time text like
   'Monday 16:30', return {:start-day :stop-day :start-local :stop-local}."
  [shift-name anchor-label]
  (let [{:keys [start stop]} (shift-times shift-name)
        start-local (format-hhmm start)
        stop-local (format-hhmm stop)
        spans-midnight? (> (minutes-of-day start) (minutes-of-day stop))
        [day time] (str/split (str/trim anchor-label) #"\s+" 2)
        hour (Integer/parseInt (first (str/split time (re-pattern ":"))))
        start-day (if (and spans-midnight? (< hour (first stop))) 
                    (prev-weekday day)
                    day)
        stop-day (if spans-midnight? (next-weekday start-day) start-day)]
    {:start-day start-day :stop-day stop-day
     :start-local start-local :stop-local stop-local}))

(defn longest-stopped-gap-minutes [shift-name]
  (let [{:keys [start stop]} (shift-times shift-name)
        work (if (< (minutes-of-day start) (minutes-of-day stop))
               (- (minutes-of-day stop) (minutes-of-day start))
               (+ (- (* 24 60) (minutes-of-day start)) (minutes-of-day stop)))]
    (- (* 24 60) work)))

(defn manual-start-outside-shift?
  "A human start outside the active shift must not be fought by machinery."
  [{:keys [shift-name now-minutes manual-start?]}]
  (when-let [{:keys [start stop]} (shift-times shift-name)]
    (boolean (and manual-start?
                  (not (within-shift-minutes? now-minutes start stop))))))

(defn effective-close-local
  "Signature-backed outage minutes credit toward close, capped; swarm crashes
   never credit."
  [{:keys [scheduled-stop-local outage-minutes swarm-caused? cap-minutes]
    :or {cap-minutes default-outage-credit-cap-minutes}}]
  (if (or swarm-caused? (not (pos? (or outage-minutes 0))))
    scheduled-stop-local
    (let [parsed (parse-hhmm scheduled-stop-local)
          credit (min (long outage-minutes) (long cap-minutes))
          total (+ (minutes-of-day parsed) credit)
          h (quot total 60)
          m (mod total 60)]
      (format-hhmm [(mod h 24) m]))))

(defn extended-close-announcement-text
  "Operator-topic copy for a credited close extension (pure; IO elsewhere)."
  [{:keys [shift outage-minutes scheduled-stop-local effective-close-local]}]
  (str "Extended close (" shift "): +" outage-minutes
       "m signature-backed provider outage → "
       effective-close-local " (scheduled " scheduled-stop-local ")"))

;; Loaded via load-file from tests and applier.
