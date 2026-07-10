;; BL-258: pure decision + adapter-injected orchestration for the headless,
;; host-independent morning briefing-GENERATION trigger. Complements
;; briefing_email_lib.bb (BL-214), which only handles the SEND of an
;; already-committed docs/briefings/<date>.md - this lib decides WHEN that
;; file should first come into existence and drives the nudge that asks the
;; coordinator to compose+commit it, headless (no VS Code host required).
;;
;; REUSE (per the ticket): keeps BL-099's briefing CONTENT (the coordinator
;; still composes it, as agentic work - see
;; extension/src/extension.ts's startOrRestartDailyBriefing) and BL-214's
;; SEND path (briefing_email_lib.bb, untouched) exactly as they are; this
;; adds only the scheduled GENERATION trigger. The literal instruction text
;; below is copied verbatim from that same extension.ts function, so the
;; coordinator sees an identical nudge regardless of which trigger (the VS
;; Code host's own timer, or this headless daemon schedule) fired it.
;;
;; IDEMPOTENT (per the ticket's own wording, "gate on the day's existing
;; briefing"): docs/briefings/<date>.md FILE PRESENCE is the whole
;; idempotency gate - the same authoritative signal BL-214's own send path
;; already keys off - rather than a second, independent "have we nudged
;; today" flag that could drift out of sync with what is actually on disk.
;; This also naturally composes across BOTH triggers being present (the VS
;; Code host's timer AND this headless schedule): whichever writes the file
;; first makes every later check, from either trigger, see it and stay
;; quiet.
(ns briefing-generation-schedule-lib
  (:require [babashka.fs :as fs]))

(defn utc-day-key
  "YYYY-MM-DD for now-ms in UTC - matches
   extension/src/notify/briefingScheduler.ts's utcDayKey and the real
   docs/briefings/<date>.md filenames exactly."
  [now-ms]
  (-> (java.time.Instant/ofEpochMilli now-ms)
      (.atZone java.time.ZoneOffset/UTC)
      .toLocalDate
      .toString))

(def default-morning-time [8 0])

(defn parse-morning-time
  "Parses an \"HH:MM\" 24h UTC string (swarmforge.conf's
   briefing_morning_time_utc) into [hour minute]. A blank/nil/malformed
   value falls back to default-morning-time - a config typo must never
   crash the sweep."
  [time-str]
  (or (when (and time-str (not (clojure.string/blank? time-str)))
        (when-let [[_ h m] (re-matches #"([01]?\d|2[0-3]):([0-5]\d)" (clojure.string/trim time-str))]
          [(Integer/parseInt h) (Integer/parseInt m)]))
      default-morning-time))

(defn scheduled-ms-today
  "Epoch ms for hour:minute UTC on now-ms's own UTC calendar day."
  [now-ms hour minute]
  (-> (java.time.Instant/ofEpochMilli now-ms)
      (.atZone java.time.ZoneOffset/UTC)
      .toLocalDate
      (.atTime hour minute)
      (.toInstant java.time.ZoneOffset/UTC)
      .toEpochMilli))

(defn briefing-file-path [briefings-dir day-key]
  (str (fs/path briefings-dir (str day-key ".md"))))

(defn briefing-already-generated? [briefings-dir day-key]
  (fs/exists? (briefing-file-path briefings-dir day-key)))

(defn morning-trigger-due?
  "True when now-ms is at/after the configured morning time on its own UTC
   calendar day AND that day's briefing file does not yet exist."
  [now-ms morning-hour morning-minute briefings-dir]
  (and (>= now-ms (scheduled-ms-today now-ms morning-hour morning-minute))
       (not (briefing-already-generated? briefings-dir (utc-day-key now-ms)))))

(defn briefing-due-instruction
  "BL-099's own literal nudge text (extension.ts's
   startOrRestartDailyBriefing), reused verbatim and parametrized only by
   the target date, so the coordinator's own composition instructions never
   diverge between the host timer and this headless trigger."
  [day-key]
  (str "Daily briefing due: compose today's briefing per your role and commit it to docs/briefings/" day-key ".md."))

(defn generate-briefing-if-due!
  "The whole trigger decision + action, adapter-injected (mirrors
   briefing_email_lib.bb's send-unsent-briefings! shape) so the DECISION is
   directly testable with a fake :notify!/:log! adapter pair and an
   injected now-ms - no real tmux, no real timer, in every unit test.
   :notify! is called with the built instruction text exactly once when
   due. Returns true when it fired, false when skipped (already generated
   today, or the configured time has not yet been reached)."
  [now-ms morning-hour morning-minute briefings-dir adapters]
  (let [day-key (utc-day-key now-ms)]
    (if (morning-trigger-due? now-ms morning-hour morning-minute briefings-dir)
      (do
        ((:notify! adapters) (briefing-due-instruction day-key))
        ((:log! adapters) "briefing-generation-nudge-sent" day-key)
        true)
      false)))
