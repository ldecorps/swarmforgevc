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
  {;; No git commit on the claimed task for this long before idle reclaims
   ;; start (large features need headroom to spec/survey before first commit).
   :claim-idle-timeout-ms (* 20 60 1000)
   ;; Roles that legitimately run longer without commits (mutation passes).
   ;; hardender: Stryker/gherkin-mutator runs often exceed 1h wall-clock.
   :role-idle-timeout-ms {"hardender" (* 90 60 1000)}
   ;; After the idle timeout, probe the agent once before counting reclaims.
   :probe-grace-ms (* 10 60 1000)
   ;; Idle reclaims before nudging again (first nudge fires at 1).
   :nudge-threshold 1
   ;; Idle reclaims before we log a bounce-claim event (reassign/release).
   :bounce-threshold 6
   ;; Idle reclaims before we halt the swarm.
   :halt-threshold 10})

;; ── sidecar path ─────────────────────────────────────────────────────────────

(defn claim-progress-sidecar-path [in-process-file-path]
  (str in-process-file-path ".claim-progress.json"))

;; ── sidecar data shape: {:claimCommit str :claimAtMs long :reclaims int
;;                         :idleProbeAtMs long (optional)} ────────────────────

(defn resolve-claim-idle-timeout-ms
  "Per-role override (e.g. hardender mutation runs) or config default."
  [role config]
  (let [cfg (merge default-config config)]
    (or (get-in cfg [:role-idle-timeout-ms role])
        (:claim-idle-timeout-ms cfg))))

(defn worktree-dirty?
  "True when git status --porcelain shows staged/modified/untracked work."
  [porcelain]
  (boolean (not (str/blank? (str/trim (or porcelain ""))))))

(defn mark-idle-probe [progress now-ms]
  (assoc progress :idleProbeAtMs now-ms))

(defn mono-router-dormant-stale-claim?
  "True when a dormant role's mailbox still holds in_process but the resident
   pane has rotated to a different identity (mono-router topology)."
  [claim-role active-role rotation-router?]
  (and rotation-router?
       (not (str/blank? (str claim-role)))
       (not (str/blank? (str active-role)))
       (not= (str claim-role) (str active-role))))

(defn pause-for-active-rotation
  "Reset reclaim pressure while another identity owns the resident pane."
  [progress now-ms]
  (-> progress
      (assoc :claimAtMs now-ms :reclaims 0)
      (dissoc :idleProbeAtMs)))

(defn resident-shows-work?
  "True when the mono-router resident pane is mid-turn or had recent output."
  [{:keys [resident-busy? resident-recently-active?]}]
  (boolean (or resident-busy? resident-recently-active?)))

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
  [progress current-commit-10 now-ms config & {:keys [role]}]
  (let [cfg (merge default-config config)
        claim-commit (or (:claimCommit progress) "")
        claim-at-ms  (or (:claimAtMs progress) 0)
        timeout-ms   (resolve-claim-idle-timeout-ms role cfg)
        elapsed-ms   (- now-ms claim-at-ms)]
    (cond
      (and (not (str/blank? current-commit-10))
           (not (str/blank? claim-commit))
           (not= current-commit-10 claim-commit))
      :progressed

      (>= elapsed-ms timeout-ms)
      :claimed-idle

      :else
      :not-yet-overdue)))

(defn evaluate-claim-idle-signal
  "BL-528 gate: before counting an idle reclaim, skip when the resident is
   working, the worktree has uncommitted work, or (mono-router) a dormant
   role's mailbox is stale while another identity is active; otherwise probe
   the agent once and wait :probe-grace-ms before incrementing reclaims.
   Returns :progressed | :not-yet-overdue | :paused-dormant | :probe-agent |
   :claimed-idle."
  [progress current-commit-10 now-ms config
   {:keys [role agent-busy? worktree-dirty? resident-busy? resident-recently-active?
           active-role rotation-router?]}]
  (let [cfg (merge default-config config)]
    (cond
      (mono-router-dormant-stale-claim? role active-role rotation-router?)
      :paused-dormant

      (resident-shows-work? {:resident-busy? resident-busy?
                             :resident-recently-active? resident-recently-active?})
      :not-yet-overdue

      :else
      (let [base (classify-claim-progress progress current-commit-10 now-ms cfg {:role role})]
        (case base
          :progressed :progressed
          :not-yet-overdue :not-yet-overdue
          :claimed-idle
          (cond
            worktree-dirty? :not-yet-overdue
            (or agent-busy? resident-busy?) :not-yet-overdue
            (and (zero? (long (or (:reclaims progress) 0)))
                 (nil? (:idleProbeAtMs progress)))
            :probe-agent
            (and (:idleProbeAtMs progress)
                 (< (- now-ms (long (:idleProbeAtMs progress))) (:probe-grace-ms cfg)))
            :not-yet-overdue
            :else :claimed-idle))))))

(defn should-refuse-claim-halt?
  "Last-line guard: never kill the swarm while the resident is working or a
   dormant mailbox claim is stale under mono-router rotation."
  [{:keys [role resident-busy? resident-recently-active? active-role rotation-router?]}]
  (or (resident-shows-work? {:resident-busy? resident-busy?
                              :resident-recently-active? resident-recently-active?})
      (mono-router-dormant-stale-claim? role active-role rotation-router?)))

(defn format-idle-probe-message
  [{:keys [role elapsed-min]}]
  (str "BL-528 idle-claim check: role " role " has had no git commit for ~"
       elapsed-min " min on this claim. "
       (if (= role "hardender")
         "Long mutation runs are expected — if you're still hardening, keep working. "
         "If you're still making useful progress, keep working. ")
       "If idle or stuck, commit progress or release the claim."))

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
       "Swarm halted. Fix the idle claim path, then relaunch with ./start-swarm-anthropic.sh (not bare ./swarm)."))

(defn format-email-subject [role]
  (str "SwarmForge: claim-without-progress halt (" role ") — swarm stopped"))

(defn format-telegram-alert [role reclaims]
  (str "🚨 Swarm HALTED — claim-without-progress on `" role "` "
       "(reclaims=" reclaims "). "
       "Role held a task but pushed no commits; kill_all_swarm ran. "
       "Fix the idle claim path, then relaunch with ./start-swarm-anthropic.sh (not bare ./swarm)."))

(defn format-bounce-log [role reclaims]
  (str "Claim-without-progress bounce on role '" role
       "' (reclaims=" reclaims "). Releasing claim for re-routing."))
