;; babysitter_lib.bb — pure wake/observe scheduling for the outside-chain hawk.
;;
;; The LLM idles at a prompt. A cheap runtime loop decides WHEN to inject a
;; wake: (1) an agent handed off a ticket, or (2) the periodic observe timer
;; (~20 min) elapsed. No network, no clock read inside these fns — callers
;; inject now-ms.

(ns babysitter-lib
  (:require [clojure.string :as str]
            [cheshire.core :as json]))

(def default-observe-interval-ms (* 20 60 1000))
(def default-debounce-ms 30000)

(defn next-observe-due?
  "True when no observe has run yet, or interval-ms has elapsed since last."
  [now-ms last-observe-ms interval-ms]
  (or (nil? last-observe-ms)
      (>= (- now-ms last-observe-ms) interval-ms)))

(defn should-fire-observe?
  "Fire when timer is due OR pending wake events exist, subject to debounce
   so a burst of handoffs does not thrash the LLM."
  [{:keys [now-ms last-observe-ms interval-ms pending-count debounce-ms last-fire-ms]
    :or {interval-ms default-observe-interval-ms
         debounce-ms default-debounce-ms
         pending-count 0}}]
  (let [due-timer (next-observe-due? now-ms last-observe-ms interval-ms)
        has-pending (pos? (long pending-count))
        debounce-ok (or (nil? last-fire-ms)
                        (>= (- now-ms last-fire-ms) debounce-ms))]
    (boolean (and debounce-ok (or due-timer has-pending)))))

(defn classify-wake-reason
  "Prefer handoff over timer when both apply."
  [pending-events timer-due?]
  (cond
    (seq pending-events) :handoff
    timer-due? :timer
    :else :none))

(defn format-wake-message
  "Chat text injected into the babysitter pane."
  [reason events]
  (let [header (case reason
                 :handoff "WAKE [handoff]: an agent just handed off work."
                 :timer "WAKE [timer]: periodic swarm observe (~20 min)."
                 "WAKE: observe the swarm.")
        detail (when (seq events)
                 (str "\nEvents:\n"
                      (->> events
                           (take 8)
                           (map (fn [e]
                                  (str "- "
                                       (or (:type e) "event")
                                       (when-let [f (:from e)] (str " from=" f))
                                       (when-let [t (:to e)] (str " to=" t))
                                       (when-let [task (:task e)] (str " task=" task)))))
                           (str/join "\n"))))
        footer (str "\nRun ONE observe pass per your prompt (use ! shell; "
                    "do NOT ask to add files). "
                    "Post glitches to Telegram (notify-babysitter). "
                    "Then idle at > — do NOT self-schedule sleeps or loops; "
                    "the babysitter runtime will wake you again.")]
    (str header detail footer)))

(defn parse-wake-queue-line
  "Parse one jsonl wake event; nil on malformed."
  [line]
  (let [trimmed (str/trim (str line))]
    (when-not (str/blank? trimmed)
      (try
        (let [obj (json/parse-string trimmed true)]
          (when (map? obj) obj))
        (catch Exception _ nil)))))

(defn parse-wake-queue
  [content]
  (->> (str/split-lines (or content ""))
       (keep parse-wake-queue-line)
       vec))

(defn handoff-wake-event
  "Shape written by handoffd after a successful deliver!."
  [{:keys [from to path task type at]}]
  (cond-> {:type (or type "handoff")
           :from (str from)
           :to (if (sequential? to) (str/join "," to) (str to))
           :path (str path)}
    task (assoc :task (str task))
    at (assoc :at (str at))))
