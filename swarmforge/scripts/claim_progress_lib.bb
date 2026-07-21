;; BL-528: Auto-heal claim-without-progress.
;;
;; Problem: a role can claim a task (in_process) and sit idle at a prompt —
;; re-running ready_for_next counts as "pane activity" and resets the stuck
;; detector, so the swarm looks healthy while no real work is done.
;;
;; This lib adds a second dimension: did the role's git worktree HEAD advance
;; since the task was claimed? It tracks a .claim-progress.json sidecar beside
;; each in_process handoff and provides pure classify/decide functions the
;; daemon's sweep-in-process! calls through an adapter.
;;
;; Escalation ladder (mirrors loop_detect_lib.bb and stuck-in-process):
;;   1. First idle reclaim detected → nudge (wake, send in-process-resume if
;;      available)
;;   2. Reclaims reach :nudge-threshold → bounce-claim (release/reassign via
;;      dispatch-gap or coordinator note)
;;   3. Reclaims reach :halt-threshold → same Telegram+email halt as NO_TASK
;;      spin (kill_all_swarm)
;;
;; Pure: no filesystem I/O. State is managed through the sidecar read/write
;; helpers below; the caller (handoffd.bb's adapters) owns persistence.

(ns claim-progress-lib
  (:require [clojure.string :as str]))

(def default-config
  {;; Minutes without a new commit before we start counting idle reclaims.
   :claim-idle-timeout-ms (* 5 60 1000)
   ;; Idle reclaims before nudging again (first nudge fires at 1).
   :nudge-threshold 1
   ;; Idle reclaims before we log a bounce-claim event (reassign/release).
   :bounce-threshold 3
   ;; Idle reclaims before we halt the swarm.
   :halt-threshold 5})

;; ── sidecar path ─────────────────────────────────────────────────────────────

(defn claim-progress-sidecar-path [in-process-file-path]
  (str in-process-file-path ".claim-progress.json"))

;; ── sidecar data shape: {:claimCommit str :claimAtMs long :reclaims int} ────

(defn make-claim-progress
  "Initial sidecar data written when a task enters in_process."
  [commit-10 now-ms]
  {:claimCommit (or commit-10 "") :claimAtMs now-ms :reclaims 0})

(defn increment-reclaims [progress]
  (update progress :reclaims (fnil inc 0)))

;; ── pure classification ───────────────────────────────────────────────────────

(defn classify-claim-progress
  "Classify whether a role has made durable progress on a claimed task.
   Returns :progressed | :claimed-idle | :not-yet-overdue.
   :progressed     — HEAD has advanced past claimCommit; sidecar can be reset.
   :claimed-idle   — HEAD unchanged AND claim-idle-timeout has elapsed.
   :not-yet-overdue — HEAD unchanged but still within tolerance."
  [progress current-commit-10 now-ms config]
  (let [cfg (merge default-config config)
        claim-commit (or (:claimCommit progress) "")
        claim-at-ms  (or (:claimAtMs progress) 0)
        elapsed-ms   (- now-ms claim-at-ms)]
    (cond
      (and (not (str/blank? current-commit-10))
           (not (str/blank? claim-commit))
           (not= current-commit-10 claim-commit))
      :progressed

      (>= elapsed-ms (:claim-idle-timeout-ms cfg))
      :claimed-idle

      :else
      :not-yet-overdue)))

(defn decide-claim-idle-action
  "Given the current reclaim count (AFTER incrementing for this observation),
   decide what the daemon should do.
   Returns :nudge | :bounce | :halt."
  [reclaims config]
  (let [cfg (merge default-config config)]
    (cond
      (>= reclaims (:halt-threshold cfg))   :halt
      (>= reclaims (:bounce-threshold cfg)) :bounce
      :else                                  :nudge)))

;; ── alert formatting ──────────────────────────────────────────────────────────

(defn format-halt-reason [role reclaims]
  (str "Claim-without-progress halt on role '" role
       "' (reclaims=" reclaims
       "). Role held an in_process task but made no git commits. "
       "Swarm halted. Fix the idle claim path, then relaunch with ./swarm."))

(defn format-email-subject [role]
  (str "SwarmForge: claim-without-progress halt (" role ") — swarm stopped"))

(defn format-telegram-alert [role reclaims]
  (str "🚨 Swarm HALTED — claim-without-progress on `" role "` "
       "(reclaims=" reclaims "). "
       "Role held a task but pushed no commits; kill_all_swarm ran. "
       "Fix the idle claim path, then relaunch with ./swarm."))

(defn format-bounce-log [role reclaims]
  (str "Claim-without-progress bounce on role '" role
       "' (reclaims=" reclaims "). Releasing claim for re-routing."))
