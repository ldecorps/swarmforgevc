;; BL-149: mutation-testing eligibility gate. A file-change cooldown runs
;; AHEAD of the existing office-hours/host-load bypass (hardender.prompt) - a
;; file still actively churning should not be prematurely stabilized by
;; mutation testing, regardless of time of day. Kept pure so the decision is
;; testable without real git plumbing or a real host load average
;; (constitution testability boundary); only the thin CLI wrapper
;; (mutation_cooldown_gate.bb) touches git, /proc/loadavg or `uptime`, `nproc`,
;; and the real clock.
(ns mutation-cooldown-lib
  (:require [clojure.string :as str]))

;; Same `config <key> <value>` line shape as the rest of swarmforge.conf
;; (mirrors daemon_alarm_lib.bb's parse-conf and the inline readers in
;; ready_for_next.bb/swarm_handoff.bb - kept local here rather than a shared
;; import so this lib stays a single, independently loadable file).
(defn parse-conf
  [content]
  (into {}
        (for [line (str/split-lines (or content ""))
              :let [line (str/trim line)]
              :when (str/starts-with? line "config ")
              :let [[_ k v] (re-matches #"config\s+(\S+)\s+(.*)" line)]
              :when k]
          [k (str/trim v)])))

(def default-cooldown-days 3)
;; hardender.prompt's existing prose bypass: "load average exceeds ~2x the
;; core count". Now a config default instead of a hardcoded constant.
(def default-busy-load-multiplier 2)

(defn cooldown-days
  "Reads `config mutation_cooldown_days <N>` fresh from parsed conf content,
   falling back to the default when absent or unparsable - never a
   remembered value (workflow.prompt: config is read fresh at decision time)."
  [conf]
  (or (some-> (get conf "mutation_cooldown_days") parse-long) default-cooldown-days))

(defn busy-load-multiplier
  [conf]
  (or (some-> (get conf "mutation_busy_load_multiplier") parse-double) default-busy-load-multiplier))

(defn host-busy?
  "The existing load-average office-hours signal, now a configurable
   multiplier rather than a prose '~2x cores' constant."
  [load-avg core-count multiplier]
  (> load-avg (* multiplier core-count)))

;; BL-149 cooldown-gate-01..04: the cooldown is a hard skip with no
;; exceptions, and it is checked FIRST - a file within cooldown is skipped
;; whether the host is busy or quiet. Only once a file is past cooldown does
;; the existing host-business bypass get consulted at all: skip while busy
;; (deferred, still due), run once quiet. Net effect: mutation testing only
;; ever runs when the file is both past cooldown AND the host is quiet.
(defn decide-mutation-gate
  [last-modified-ms now-ms cooldown-days* host-busy]
  (let [cooldown-ms (* cooldown-days* 24 60 60 1000)
        age-ms (- now-ms last-modified-ms)]
    (cond
      (< age-ms cooldown-ms) :skip-cooldown
      host-busy :skip-busy
      :else :run)))
