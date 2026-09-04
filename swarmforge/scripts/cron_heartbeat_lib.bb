#!/usr/bin/env bb
;; BL-1392: is the cron daemon this swarm schedules into actually alive?
;;
;; Cron cannot report its own death, and nothing read the evidence it leaves
;; behind. On this WSL2 host cron stopped on 2026-08-30 06:52 BST and every
;; ./swarm start since printed "Installed" over a dead scheduler: the BL-675
;; watchdog that restarts a dead handoffd was off for five days, every shift
;; boundary was manual, and the 17:00 bedtime never fired.
;;
;; The install-time probe (install_swarmforge_crons.sh's CRON_DAEMON_DOWN) is
;; only half the answer - it is green at start and blind afterwards, the
;; BL-1235 shape. This is the other half: the freshness cron writes its log
;; every 2 minutes, so the AGE of that log is a heartbeat cron itself keeps,
;; and the daemon - which cron does not run - is the one process that can read
;; it.
;;
;; Pure decision here; the daemon owns the clock, the filesystem and the
;; escalation channel.

(ns cron-heartbeat-lib)

;; The freshness cron runs every 2 minutes. Ten tolerates a slow host, a long
;; freshness check and a tick landing either side of the boundary, while still
;; naming a dead cron in minutes rather than days.
(def default-bound-ms (* 10 60 1000))

(defn cron-heartbeat-verdict
  "What to do about the freshness cron log, this tick.

   `:fresh`                 - written within the bound. Clears the episode, so
                              a later death escalates again (BL-920 self-heal).
   `:stale-escalate`        - past the bound and this episode has not escalated
                              yet: log `cron-heartbeat-stale` and escalate ONCE.
   `:stale-already-escalated` - past the bound, already escalated: stay quiet.
                              A second signal every tick is noise, not news.
   `:absent-escalate` / `:absent-already-escalated` - the log does not exist at
                              all. That is the same symptom in its starkest
                              form (cron has never written), so it escalates on
                              the same once-per-episode rule, with its own name
                              so the message can say which it saw.
   `:unknown` - the age could not be read. Never an escalation and never a
                clear: an unreadable mtime is not evidence of death OR of life,
                and inventing either would make this watchdog the thing that
                needs watching.

   `age-ms` nil with `present?` true means the age was unreadable."
  [{:keys [present? age-ms bound-ms escalated?]}]
  (let [bound (or bound-ms default-bound-ms)]
    (cond
      (not present?) (if escalated? :absent-already-escalated :absent-escalate)
      (nil? age-ms) :unknown
      (<= age-ms bound) :fresh
      escalated? :stale-already-escalated
      :else :stale-escalate)))

(defn escalating?
  "Does this verdict mean 'raise it now'? One place, so the daemon's log line
   and its escalation can never disagree about which ticks are noisy."
  [verdict]
  (contains? #{:stale-escalate :absent-escalate} verdict))

(defn next-episode-state
  "The episode flag to persist after acting on `verdict`. Fresh clears it (so
   cron dying again is news again); an escalation sets it; everything else -
   including `:unknown` - leaves it exactly as it was."
  [state verdict]
  (case verdict
    :fresh (assoc state :escalated false)
    (:stale-escalate :absent-escalate) (assoc state :escalated true)
    state))

(defn stale-message
  "What the escalation says. It names the age, the bound and the host fix, and
   it never suggests the swarm will start cron itself - that needs root and is
   the host owner's (invariant 3)."
  [{:keys [verdict age-ms bound-ms log-path]}]
  (let [bound (or bound-ms default-bound-ms)
        minutes (fn [ms] (int (/ (or ms 0) 60000)))]
    (str "cron-heartbeat-stale: "
         (if (= verdict :absent-escalate)
           (str "the freshness cron log " log-path " does not exist, so cron has never run here")
           (str "the freshness cron log " log-path " was last written " (minutes age-ms)
                " minute(s) ago, past the " (minutes bound) "-minute bound"))
         ". NOTHING scheduled is firing - not the freshness watchdog, not shift start or"
         " bedtime, not the descent review. Start the daemon on the host with"
         " 'sudo service cron start', and add a [boot] section with"
         " command=\"service cron start\" to /etc/wsl.conf so it survives a restart."
         " The swarm does not start cron itself: that needs root.")))
