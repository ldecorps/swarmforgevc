#!/usr/bin/env bb
;; BL-1392: PROPERTY runner over the three invariants the ticket YAML declares
;; (coder-authored first, per BL-654). Its own command, never the unit lane.
;;
;;   P1 no install reports success while no daemon runs - the installer's
;;      probe is a shell script, so its half is proved by the e2e; what is
;;      exhaustively checked HERE is the runtime decision the daemon makes.
;;   P2 escalate ONCE per episode, stay quiet while stale, and re-arm after a
;;      fresh log: over every (presence x age x episode-flag) combination, an
;;      escalation happens only on the FIRST tick of an episode, and only a
;;      fresh log clears the flag.
;;   P3 the decision never starts cron: it is pure - no process, no shell, no
;;      filesystem - and its message names the fix as the host owner's.
;;
;; EXHAUSTIVE over the grid rather than sampled: presence (2) x ages spanning
;; both sides of the bound including its exact boundary (6, plus unreadable) x
;; episode flag (2). Every cell asserts it was reached, and the episode
;; transitions are walked as a SEQUENCE too - a per-tick property alone cannot
;; see "escalates once, then again after recovery", which is the whole rule.

(require '[babashka.fs :as fs] '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "cron_heartbeat_lib.bb")))

(def failures (atom []))
(defn fail! [m] (swap! failures conj (str "FAIL: " m)))
(def reached (atom {}))
(defn note! [k] (swap! reached update k (fnil inc 0)))

(def BOUND cron-heartbeat-lib/default-bound-ms)
(def ages [0 60000 (dec BOUND) BOUND (inc BOUND) (* 10 BOUND) nil])

;; ── the grid ──────────────────────────────────────────────────────────────
(doseq [present? [true false]
        age ages
        escalated? [true false]]
  (let [v (cron-heartbeat-lib/cron-heartbeat-verdict
           {:present? present? :age-ms age :escalated? escalated?})
        escalating? (cron-heartbeat-lib/escalating? v)
        next-state (cron-heartbeat-lib/next-episode-state {:escalated escalated?} v)]
    (note! (cond (not present?) :absent (nil? age) :unknown (<= age BOUND) :fresh :else :stale))
    ;; P2: an escalation only ever on the FIRST tick of an episode.
    (when (and escalating? escalated?)
      (fail! (str "P2: escalated twice in one episode: present? " present? " age " age)))
    ;; P2: a stale or absent log with no escalation yet MUST escalate - a
    ;; watchdog that stays quiet about a dead scheduler is the defect.
    (when (and (not escalated?) (or (not present?) (and (some? age) (> age BOUND))) (not escalating?))
      (fail! (str "P2: a dead cron went unreported: present? " present? " age " age)))
    ;; P2: only a fresh log clears the episode.
    (when (and (:escalated next-state) (= v :fresh))
      (fail! "P2: a fresh log did not clear the episode"))
    (when (and (not (:escalated next-state)) escalated? (not= v :fresh))
      (fail! (str "P2: the episode was cleared by something other than a fresh log: " v)))
    ;; An unreadable age is never evidence either way.
    (when (and (nil? age) present? (or escalating? (not= (:escalated next-state) escalated?)))
      (fail! "P2: an unreadable age escalated or cleared an episode"))))

;; ── the episode, walked as a sequence (the rule a per-tick check cannot see) ─
(let [ticks [[true (* 20 BOUND)] [true (* 21 BOUND)] [true 1000] [true (* 30 BOUND)]]
      escalations (loop [state {:escalated false} [t & more] ticks acc []]
                    (if (nil? t)
                      acc
                      (let [[present? age] t
                            v (cron-heartbeat-lib/cron-heartbeat-verdict
                               (assoc {:present? present? :age-ms age} :escalated? (:escalated state)))]
                        (recur (cron-heartbeat-lib/next-episode-state state v) more
                               (conj acc (cron-heartbeat-lib/escalating? v))))))]
  (note! :sequence)
  (when-not (= escalations [true false false true])
    (fail! (str "P2 sequence: expected escalate, quiet, quiet(recovered), escalate-again; got " escalations))))

;; ── P3: the decision cannot start cron, and says whose job it is ──────────
(let [msg (cron-heartbeat-lib/stale-message
           {:verdict :stale-escalate :age-ms (* 20 BOUND) :log-path "/x/f.log"})
      src (slurp (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "cron_heartbeat_lib.bb")))]
  (note! :message)
  (when-not (str/includes? msg "needs root")
    (fail! "P3: the message does not say starting cron is the host owner's"))
  ;; Pure by construction: no process, no shell, no filesystem in the lib.
  (doseq [forbidden ["babashka.process" "sh!" "System/exec" "clojure.java.shell" "slurp"]]
    (when (str/includes? src forbidden)
      (fail! (str "P3: the decision lib reaches for " forbidden " - it must stay pure")))))

(doseq [shape [:absent :unknown :fresh :stale :sequence :message]]
  (when-not (pos? (get @reached shape 0))
    (fail! (str "never exercised the " shape " shape"))))

(if (empty? @failures)
  (println (str "bl1392_cron_heartbeat_property: ALL PROPERTIES HOLD over "
                (reduce + (vals @reached)) " constructed cases"))
  (do (println (str "bl1392_cron_heartbeat_property: " (count @failures) " FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
