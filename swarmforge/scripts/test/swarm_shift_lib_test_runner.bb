#!/usr/bin/env bb
;; BL-660 unit tests for swarm_shift_lib.bb and shift_schedule_applier_lib.bb

(ns swarm-shift-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "swarm_shift_lib.bb")))
(load-file (str (fs/path script-dir ".." "shift_schedule_applier_lib.bb")))

(def failures (atom []))
(defn assert= [msg e a] (when (not= e a) (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str e) "\n  actual: " (pr-str a)))))
(defn assert-true [msg a] (assert= msg true (boolean a)))

;; ── night shift single source (scenario 01) ─────────────────────────────────
(let [conf "config swarm_shift night\n"
      s (swarm-shift-lib/resolve-schedule conf)]
  (assert= "night start" "01:00" (:start-local s))
  (assert= "night stop" "09:00" (:stop-local s))
  (assert= "closure" "09:00" (:closure-stop-local s))
  (assert= "cooldown start" "09:00" (:cooldown-start-local s))
  (assert= "cooldown end" "01:00" (:cooldown-end-local s))
  (assert-true "cooldown enabled" (:cooldown-window-enabled s)))

;; ── absent shift (scenario 03) ──────────────────────────────────────────────
(assert= "absent shift" nil (swarm-shift-lib/resolve-schedule "config cooldown_window_enabled false\n"))

;; ── stopped gap < 24h (scenario 06) ─────────────────────────────────────────
(doseq [shift ["day" "evening" "night"]]
  (assert-true (str shift " gap < 24h")
               (< (swarm-shift-lib/longest-stopped-gap-minutes shift) (* 24 60))))

;; ── outage credit (scenarios 09/10) ─────────────────────────────────────────
(assert= "credits 90m" "10:30"
       (swarm-shift-lib/effective-close-local {:scheduled-stop-local "09:00"
                                               :outage-minutes 90
                                               :swarm-caused? false
                                               :cap-minutes 120}))
(assert= "swarm crash no credit" "09:00"
       (swarm-shift-lib/effective-close-local {:scheduled-stop-local "09:00"
                                               :outage-minutes 90
                                               :swarm-caused? true}))

;; ── day→evening reconcile (scenario 02) ─────────────────────────────────────
(let [root "/tmp/swarm-root-2"
      day-pass (shift-schedule-applier-lib/reconcile-crontab
                []
                {:root root :start-local [9 0] :stop-local [17 0]
                 :start-script "/tmp/start" :stop-script "/tmp/stop"})
      evening-pass (shift-schedule-applier-lib/reconcile-crontab
                    (:lines day-pass)
                    {:root root :start-local [17 0] :stop-local [1 0]
                     :start-script "/tmp/start" :stop-script "/tmp/stop"})
      body (remove str/blank? (:managed (shift-schedule-applier-lib/split-managed (:lines evening-pass) root)))]
  (assert-true "day→evening changes" (:changed? evening-pass))
  (assert-true "evening start armed" (some #(str/includes? % "0 17") body))
  (assert-true "evening stop armed" (some #(str/includes? % "0 1") body))
  (assert-true "no stale day start" (not (some #(str/includes? % "0 9 * * *") body))))

;; ── evening calendar anchor (scenario 04) ─────────────────────────────────────
(assert= "Mon 16:30 start day" "Monday"
       (:start-day (swarm-shift-lib/calendar-anchor "evening" "Monday 16:30")))
(assert= "Mon 16:30 stop day" "Tuesday"
       (:stop-day (swarm-shift-lib/calendar-anchor "evening" "Monday 16:30")))
(assert= "Tue 00:30 start day" "Monday"
       (:start-day (swarm-shift-lib/calendar-anchor "evening" "Tuesday 00:30")))

;; ── manual start outside shift (scenario 05) ──────────────────────────────────
(assert-true "manual start outside day shift"
             (swarm-shift-lib/manual-start-outside-shift?
              {:shift-name "day" :now-minutes (* 20 60) :manual-start? true}))

;; ── running shift continues (scenario 08) ─────────────────────────────────────
(assert-true "running day continues when conf flips to evening"
             (swarm-shift-lib/running-shift-continues?
              {:running-shift "day" :requested-shift "evening"}))

;; ── extended close announcement (scenario 09) ───────────────────────────────
(let [text (swarm-shift-lib/extended-close-announcement-text
            {:shift "night"
             :outage-minutes 90
             :scheduled-stop-local "09:00"
             :effective-close-local "10:30"})]
  (assert-true "announcement names outage" (str/includes? text "90"))
  (assert-true "announcement names close" (str/includes? text "10:30")))

;; ── applier idempotent (scenario 07) ────────────────────────────────────────
(let [root "/tmp/swarm-root"
      first-pass (shift-schedule-applier-lib/reconcile-crontab
                  []
                  {:root root :start-local [1 0] :stop-local [9 0]
                   :start-script "/tmp/start" :stop-script "/tmp/stop"})
      second-pass (shift-schedule-applier-lib/reconcile-crontab
                    (:lines first-pass)
                    {:root root :start-local [1 0] :stop-local [9 0]
                     :start-script "/tmp/start" :stop-script "/tmp/stop"})
      human-line "# human cron\n0 12 * * * /usr/bin/true"
      with-human (shift-schedule-applier-lib/reconcile-crontab
                   [human-line]
                   {:root root :start-local [1 0] :stop-local [9 0]
                    :start-script "/tmp/start" :stop-script "/tmp/stop"})]
  (assert-true "first apply changes" (:changed? first-pass))
  (assert-true "second apply unchanged" (not (:changed? second-pass)))
  (assert= "human line surfaced" [human-line] (:surfaced-human with-human)))

;; ── BL-1381: the lib LOADS, and the governor is best-effort ──────────────
;;
;; This runner was red from 2026-08-27 to 2026-09-04 and nobody was told: the
;; standing bb suite is not run by any gate that blocks a commit, so a red here
;; cost nothing until a human tripped on it. The cause was a `(require
;; '[babashka.process :as process])` INSIDE budgetShiftGovernorVerdict's body -
;; SCI resolves an alias at ANALYSIS time, so the whole file failed to load and
;; every consumer died at load rather than at the governor call. The require
;; now lives in the ns form.
;;
;; That this file runs at all is the regression test for the crash. These rows
;; pin the governor's own contract so the require cannot quietly move back.

(assert-true "BL-1381: the governor symbol resolves - the lib loaded"
             (fn? shift-schedule-applier-lib/budgetShiftGovernorVerdict))

;; Absent CLI -> nil, never a throw: the verdict is best-effort and a caller
;; must not break because the governor is not built here.
(let [empty-root (str (fs/create-temp-dir {:prefix "bl1381-nogov-"}))]
  (assert= "BL-1381: an absent governor CLI yields nil, not an exception"
           nil (shift-schedule-applier-lib/budgetShiftGovernorVerdict empty-root 1234)))

;; Present CLI -> its parsed verdict. A real node script, because the point is
;; that process/shell resolves and runs at all.
(let [root (str (fs/create-temp-dir {:prefix "bl1381-gov-"}))
      cli-dir (str root "/extension/out/tools")]
  (fs/create-dirs cli-dir)
  (spit (str cli-dir "/budget-shift-governor.js")
        "console.log(JSON.stringify({verdict:'ok',now:process.argv[3]}));")
  (let [v (shift-schedule-applier-lib/budgetShiftGovernorVerdict root 4242)]
    (assert= "BL-1381: a present governor CLI yields its parsed verdict"
             "ok" (:verdict v))
    (assert= "BL-1381: and is handed the now-ms it was called with"
             "4242" (:now v))))

;; A CLI that exits non-zero, or prints unparseable output, is still nil -
;; best-effort means best-effort in both directions.
(let [root (str (fs/create-temp-dir {:prefix "bl1381-govfail-"}))
      cli-dir (str root "/extension/out/tools")]
  (fs/create-dirs cli-dir)
  (spit (str cli-dir "/budget-shift-governor.js") "process.exit(3);")
  (assert= "BL-1381: a governor that fails yields nil rather than throwing"
           nil (shift-schedule-applier-lib/budgetShiftGovernorVerdict root 1)))

(if (empty? @failures)
  (println "swarm_shift_lib: ALL TESTS PASSED")
  (do (doseq [f @failures] (println f)) (System/exit 1)))
