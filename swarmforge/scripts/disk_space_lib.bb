#!/usr/bin/env bb
;; BL-412: pure decision logic for the disk-space early-warning alert - see
;; operator_runtime.bb's disk-space-sweep! for the thin wiring slice (df
;; reads via an injectable seam, reply-outbox delivery, state persistence)
;; that calls this.
;;
;; Two independently-evaluated filesystems (the VHDX-on-C: mechanism means
;; WSL can report plenty of free space while the Windows C: volume backing
;; the dynamically-growing VHDX is nearly full - an overnight ENOSPC took the
;; whole swarm down this way):
;;   :mnt-c     - the Windows host volume backing the VHDX, ABSOLUTE
;;                free-GB thresholds (the VHDX grows in large increments, so
;;                a percentage of its own size is meaningless).
;;   :wsl-root  - the WSL root filesystem, PERCENT-used thresholds (its own
;;                size is fixed).
;;
;; Change-gated (BL-394 lesson): a level is announced only on a TRANSITION
;; from the last-announced level for that filesystem, never every tick.

(ns disk-space-lib)

(defn env-num
  "Reads a numeric env value out of an injected env MAP (never System/getenv
   directly - the missing-seam rule: a pure function must be testable with a
   plain map, not by mutating the real process environment). Falls back to
   default on an absent or unparsable value."
  [env name default]
  (if-let [v (get env name)]
    (try (Double/parseDouble v) (catch Exception _ default))
    default))

(defn thresholds
  "Arity-1 (env map) is the pure, testable form a unit test drives directly.
   Arity-0 is the production convenience wrapper that reads the REAL process
   environment - never called from a test."
  ([] (thresholds (into {} (System/getenv))))
  ([env]
   {:mnt-c    {:warn-free-gb     (env-num env "DISK_ALERT_MNT_C_WARN_GB" 40.0)
               :critical-free-gb (env-num env "DISK_ALERT_MNT_C_CRITICAL_GB" 15.0)}
    :wsl-root {:warn-used-pct     (env-num env "DISK_ALERT_WSL_ROOT_WARN_PCT" 90.0)
               :critical-used-pct (env-num env "DISK_ALERT_WSL_ROOT_CRITICAL_PCT" 95.0)}}))

(def mount-labels {:mnt-c "/mnt/c" :wsl-root "WSL root (/)"})

;; /mnt/c: ABSOLUTE free GB.
(defn level-for-mnt-c [{:keys [free-gb]} {:keys [warn-free-gb critical-free-gb]}]
  (cond
    (< free-gb critical-free-gb) :critical
    (< free-gb warn-free-gb) :warn
    :else :healthy))

;; WSL root: PERCENT used.
(defn level-for-wsl-root [{:keys [used-pct]} {:keys [warn-used-pct critical-used-pct]}]
  (cond
    (>= used-pct critical-used-pct) :critical
    (>= used-pct warn-used-pct) :warn
    :else :healthy))

(def level-fns {:mnt-c level-for-mnt-c :wsl-root level-for-wsl-root})

(defn message-for [mount level {:keys [free-gb used-pct]}]
  (let [label (mount-labels mount)
        detail (format "%.1f GB free, %.0f%% used" (double free-gb) (double used-pct))]
    (case level
      :critical (str "🔴 DISK CRITICAL - " label ": " detail ". The swarm can break (ENOSPC) if this continues.")
      :warn     (str "🟠 Disk space getting low - " label ": " detail ".")
      :healthy  (str "🟢 Disk space recovered - " label ": " detail "."))))

;; Pure: given the CURRENT readings for every watched mount (a map of
;; mount-keyword -> {:free-gb N :used-pct N}, omitting any mount whose read
;; failed), the PRIOR last-announced level per mount (a map of mount-NAME
;; (string, since it round-trips through persisted JSON) -> level-name
;; string, defaulting to "healthy" for a mount never seen before), and the
;; configured thresholds - returns the messages to deliver THIS tick (only
;; for a mount whose level actually changed) and the next persisted state
;; (every READ mount's CURRENT level, since the persisted state always
;; advances to reflect reality; only the MESSAGE is gated on change).
(defn disk-space-decision [readings prior-state th]
  (reduce
   (fn [acc [mount reading]]
     (let [level ((level-fns mount) reading (get th mount))
           prev (keyword (get prior-state (name mount) "healthy"))]
       (cond-> (assoc-in acc [:next-state (name mount)] (name level))
         (not= level prev) (update :messages conj {:mount mount :level level :text (message-for mount level reading)}))))
   {:messages [] :next-state {}}
   readings))
