;; BL-146: chase/nudge sweep logic, ported from extension/src/swarm/
;; inboxChaser.ts + extension/src/watchdog/{liveness,paneActivity}.ts so the
;; SAME babashka process that already owns handoff delivery (handoffd.bb)
;; also owns this duty - today it only runs inside the VS Code extension
;; host's setInterval, which is not a robust standalone process. The
;; extension host becomes a pure observer; it does not drive the sweep.
;;
;; Sidecar file formats (.chase.json, .nudge, respawn-cooldown.json) are
;; kept byte-for-byte compatible with the TS originals - same JSON key
;; names - so nothing downstream that reads them (dead-letter listing,
;; existing telemetry) needs to change.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "chase_sweep_lib.bb")))
;; and referred to as chase-sweep-lib/foo.

(ns chase-sweep-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; BL-232: reuses handoff-lib's own sidecar-suffixes definition (never a
;; second copy) for orphan reaping below.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

;; BL-1004 (architect bounce 2026-08-21): the cross-seat deferral hold the
;; claim path decides with - the sweep consults the SAME library, never a
;; second notion of deferred. backlog_depth_lib supplies the effective conf
;; path (already loaded transitively via promotion_gates_lib below; the
;; explicit load keeps this file honest about the dependency).
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "seat_affinity_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

;; BL-528: claim-without-progress detection.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "claim_progress_lib.bb")))

;; BL-678: batch-mode claim-progress sidecar (live-owner half of BL-648's
;; source near-miss) - deliberately separate from BL-528 above, see
;; batch_claim_progress_lib.bb's own header.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "batch_claim_progress_lib.bb")))

;; BL-798: reuses promotion-gates-lib's own Article 3.2.4 ranking (expedited
;; defects first, then priority) for the open-slot nudge's candidate — never
;; a second, divergent ranking, exactly what promotion_gates_lib.bb's own
;; header comment warns against.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "promotion_gates_lib.bb")))

;; ── sidecar files (exact JSON shapes/paths as inboxChaser.ts) ───────────────

(defn sidecar-path [handoff-file-path]
  (str handoff-file-path ".chase.json"))

(defn dead-letter-path [handoff-file-path]
  (str handoff-file-path ".dead"))

(defn nudge-path [item-file-path]
  (str item-file-path ".nudge"))

(defn respawn-cooldown-path [inbox-new-dir]
  (str (fs/path (fs/parent inbox-new-dir) "respawn-cooldown.json")))

(defn- read-json [path]
  (try
    (json/parse-string (slurp path) true)
    (catch Exception _ nil)))

(defn read-chase-count [handoff-file-path]
  (let [data (read-json (sidecar-path handoff-file-path))]
    (if (number? (:chaseCount data)) (:chaseCount data) 0)))

(defn read-last-chased-at-ms [handoff-file-path]
  (let [data (read-json (sidecar-path handoff-file-path))]
    (when (number? (:lastChasedAtMs data)) (:lastChasedAtMs data))))

(defn write-chase-count!
  ([handoff-file-path count] (write-chase-count! handoff-file-path count nil))
  ([handoff-file-path count last-chased-at-ms]
   (let [resolved (or last-chased-at-ms (read-last-chased-at-ms handoff-file-path))
         state (cond-> {:chaseCount count}
                 (some? resolved) (assoc :lastChasedAtMs resolved))]
     (spit (sidecar-path handoff-file-path) (json/generate-string state)))))

(defn read-nudge-count [item-file-path]
  (let [data (read-json (nudge-path item-file-path))]
    (if (number? (:nudgeCount data)) (:nudgeCount data) 0)))

(defn write-nudge-count! [item-file-path count]
  (spit (nudge-path item-file-path) (json/generate-string {:nudgeCount count})))

(defn read-respawn-cooldown-until-ms [inbox-new-dir]
  (let [data (read-json (respawn-cooldown-path inbox-new-dir))]
    (when (number? (:untilMs data)) (:untilMs data))))

(defn write-respawn-cooldown-until-ms! [inbox-new-dir until-ms]
  (spit (respawn-cooldown-path inbox-new-dir) (json/generate-string {:untilMs until-ms})))

(defn is-cooling-down? [cooldown-until-ms now-ms]
  (and (number? cooldown-until-ms) (< now-ms cooldown-until-ms)))

;; ── scanning ─────────────────────────────────────────────────────────────

(defn scan-inbox-new [inbox-new-dir]
  (if-not (fs/exists? inbox-new-dir)
    []
    (vec
     (for [entry (fs/list-dir inbox-new-dir)
           :let [name (fs/file-name entry)]
           :when (str/ends-with? name ".handoff")
           :let [path (str entry)]]
       {:filePath path
        :mtimeMs (.toMillis (fs/last-modified-time path))
        :chaseCount (read-chase-count path)
        :lastChasedAtMs (read-last-chased-at-ms path)}))))

(defn- collect-in-process [dir]
  (when (fs/exists? dir)
    (mapcat (fn [entry]
              (let [name (fs/file-name entry)]
                (cond
                  (and (fs/directory? entry) (str/starts-with? name "batch_"))
                  (collect-in-process entry)

                  (str/ends-with? name ".handoff")
                  [{:filePath (str entry)
                    :mtimeMs (.toMillis (fs/last-modified-time entry))
                    :nudgeCount (read-nudge-count (str entry))}]

                  :else [])))
            (fs/list-dir dir))))

(defn scan-in-process [in-process-dir]
  (vec (or (collect-in-process in-process-dir) [])))

;; ── pure decisions (mirrors inboxChaser.ts / liveness.ts exactly) ───────────

(defn compute-chase-backoff-seconds
  [chase-count {:keys [chaseIntervalSeconds stuckInProcessTimeoutSeconds
                        chaseBackoffBaseSeconds chaseBackoffMaxSeconds]}]
  (let [base (or chaseBackoffBaseSeconds chaseIntervalSeconds)
        max-s (or chaseBackoffMaxSeconds stuckInProcessTimeoutSeconds)]
    (min (* base (Math/pow 2 chase-count)) max-s)))

(defn unresponsive-liveness? [liveness]
  (contains? #{"dead" "unknown" "stuck"} liveness))

(defn decide-stale-item-action [chase-count config liveness]
  (if (< chase-count (:maxChases config))
    "chased"
    (if (unresponsive-liveness? liveness) "respawned" "dead-lettered")))

;; BL-499: a new/ item whose basename is ALREADY terminal (present in
;; completed/ or abandoned/ - the SAME already-terminal? predicate
;; ready_for_next_task.bb's own dequeue-time dedup applies, BL-218) is
;; reaped, never chased or dead-lettered. This precedence holds REGARDLESS
;; of the recipient's liveness/activity - a stale duplicate of provably
;; finished work is not "stuck" in any sense the age/backoff/liveness logic
;; below exists to detect; it is a known-benign migration/interrupted-
;; delivery residue (BL-128/BL-218) that the dequeue path already skips
;; forever without ever removing, so left unhandled here it would be
;; chased with exponential backoff FOREVER while the recipient stays
;; active (chaseCount hit 12+ in one live session), or false-alarm
;; dead-lettered once the recipient goes idle - neither of which reflects
;; a real stall.
;; BL-852: held? is checked AFTER already-terminal? (a provably-finished
;; duplicate is reaped regardless - see the how-to's "Terminal-reap outranks
;; the hold" note) but BEFORE every age/liveness branch below, so a held
;; parcel never reaches "chased"/"respawned"/"dead-lettered" no matter how
;; stale it looks. "held" is a distinct outcome from "skipped" (too-young-
;; to-chase-yet) even though both currently no-op in
;; apply-inbox-item-action! - the mtime/chaseCount/lastChasedAtMs inputs are
;; never touched either way, so releasing the hold resumes the normal ladder
;; from exactly the frozen values (see the ticket's freeze-the-counter note).
(defn decide-item-action
  [item-mtime-ms chase-count now-ms config liveness last-activity-ms last-chased-at-ms already-terminal? held?]
  (cond
    already-terminal? "reaped"
    held? "held"
    :else
    (let [age-seconds (/ (- now-ms item-mtime-ms) 1000.0)]
      (if (< age-seconds (:chaseTimeoutSeconds config))
        "skipped"
        (let [idle-seconds (/ (- now-ms last-activity-ms) 1000.0)
              has-recent-activity? (< idle-seconds (:stuckInProcessTimeoutSeconds config))]
          (if has-recent-activity?
            (if (nil? last-chased-at-ms)
              "chased"
              (let [seconds-since-last-chase (/ (- now-ms last-chased-at-ms) 1000.0)
                    backoff-seconds (compute-chase-backoff-seconds chase-count config)]
                (if (>= seconds-since-last-chase backoff-seconds) "chased" "skipped")))
            (decide-stale-item-action chase-count config liveness)))))))

(defn decide-stuck-action [last-activity-ms nudge-count now-ms config]
  (let [idle-seconds (/ (- now-ms last-activity-ms) 1000.0)]
    (if (< idle-seconds (:stuckInProcessTimeoutSeconds config))
      "skipped"
      (if (>= nudge-count (:maxChases config)) "alert" "nudge"))))

;; liveness.ts's computeLiveness, ported: given a heartbeat snapshot (or nil)
;; and whether its recorded pid is alive, decides the LivenessState string.
(defn compute-liveness
  [heartbeat now-ms {:keys [staleTimeoutSeconds inFlightTimeoutSeconds deadTimeoutSeconds]} pid-alive?]
  (cond
    (nil? heartbeat) "unknown"
    (not pid-alive?) "dead"
    :else
    (let [beat-ms (try (.toEpochMilli (java.time.Instant/parse (:last_beat heartbeat)))
                        (catch Exception _ nil))]
      (if (nil? beat-ms)
        "unknown"
        (let [age-seconds (/ (- now-ms beat-ms) 1000.0)]
          (if (:in_flight heartbeat)
            (if (> age-seconds inFlightTimeoutSeconds) "stuck" "alive")
            (cond
              (> age-seconds deadTimeoutSeconds) "dead"
              (> age-seconds staleTimeoutSeconds) "idle"
              :else "alive")))))))

;; ── pane-activity tracking (paneActivity.ts's trackPaneActivity, ported) ────
;; A per-role atom, same lifetime as the daemon process itself - mirrors the
;; extension host's in-memory Map (module-scope, never persisted to disk).

(def ^:private activity-records (atom {}))

(defn track-pane-activity! [role pane-content outbox-activity-ms now-ms]
  (let [digest (-> (java.security.MessageDigest/getInstance "SHA-1")
                    (.digest (.getBytes (or pane-content "") "UTF-8")))
        hash (apply str (map #(format "%02x" %) digest))
        previous (get @activity-records role)]
    (cond
      ;; First observation after daemon start is NOT proof of fresh human/agent
      ;; activity. Returning now-ms here re-armed "recently active" on every
      ;; handoffd restart and cleared stuck-email arming, so a still-stuck
      ;; in_process role re-emailed the human after each restart (flood).
      (nil? previous)
      (do (swap! activity-records assoc role {:hash hash :lastChangeMs (max 0 outbox-activity-ms)})
          (max 0 outbox-activity-ms))

      (not= (:hash previous) hash)
      (do (swap! activity-records assoc role {:hash hash :lastChangeMs now-ms})
          now-ms)

      :else
      (max (:lastChangeMs previous) outbox-activity-ms))))

(defn get-pane-last-change-ms [role]
  (get-in @activity-records [role :lastChangeMs]))

(defn pane-recently-active?
  "True when pane content changed within recent-ms (covers shell/mutation runs
   that never show Claude's esc-to-interrupt footer)."
  [role now-ms recent-ms]
  (let [last-ms (get-pane-last-change-ms role)]
    (and (some? last-ms) (< (- now-ms last-ms) recent-ms))))

(defn reset-pane-activity! []
  (reset! activity-records {}))

;; ── BL-528: claim-progress sidecar read/write ───────────────────────────────

(defn read-claim-progress [in-process-file-path]
  (let [path (claim-progress-lib/claim-progress-sidecar-path in-process-file-path)
        data (read-json path)]
    (when (and (map? data) (string? (:claimCommit data)) (number? (:claimAtMs data)))
      data)))

(defn write-claim-progress! [in-process-file-path progress]
  (spit (claim-progress-lib/claim-progress-sidecar-path in-process-file-path)
        (json/generate-string progress)))

(defn clear-claim-progress!
  "BL-528 priority bump: delete the .claim-progress.json sidecar as part of
   the halt itself. Without this, a relaunch after a claim-progress halt
   re-reads reclaims already at :halt-threshold on the daemon's first sweep -
   the probe branch requires (zero? reclaims), so the very first ungated idle
   observation re-halts immediately, skipping the whole nudge->bounce ladder.
   Deleting here means the next sweep re-initialises a fresh sidecar via
   apply-claim-progress-check!'s (or (read-claim-progress fp) (make-claim-progress ...))."
  [in-process-file-path]
  (fs/delete-if-exists (claim-progress-lib/claim-progress-sidecar-path in-process-file-path)))

;; ── impure sweep application (adapters map, mirrors ChaserAdapters) ─────────
;; adapters keys: :get-liveness :send-wake-up! :trigger-respawn! :log-dead-letter!
;;                :get-last-activity-ms :on-stuck-escalation! :log-telemetry!
;; :send-wake-up! and :send-in-process-resume! return truthy only when a pane
;; wake was actually delivered (skipped-busy/dedup/recent/failed => false).
;;                :get-role-head-commit   — BL-528: returns current 10-char HEAD
;;                                          for a role's worktree, or "" on error
;;                :on-claim-idle-bounce!  — BL-528: called when reclaims reach bounce threshold
;;                :on-claim-idle-halt!    — BL-528: called when reclaims reach halt threshold

;; BL-098: durable per-role chase/nudge/dead-letter/respawn counts. The
;; existing sidecars (.chase.json/.nudge) are ephemeral - abandoned once an
;; item completes - so nothing could answer "how many nudges did a role
;; need this week?" Every decision point below appends one event through
;; :log-telemetry! (role, event type, handoff id, count-so-far); the
;; adapter owns the timestamp and the durable file, keeping this file pure.
(defn- handoff-id [file-path]
  (fs/file-name file-path))

(defn- wake-role-delivered? [adapters role]
  (boolean
   (if-let [resume! (:send-in-process-resume! adapters)]
     (resume! role)
     ((:send-wake-up! adapters) role))))

(defn- apply-stuck-nudge! [role held adapters now-ms]
  ;; Prefer an in-process resume wake when the adapter provides one — re-running
  ;; ready_for_next on aider just reprints the same TASK and loops.
  (when (wake-role-delivered? adapters role)
    (doseq [item held]
      (let [count (inc (:nudgeCount item))]
        (write-nudge-count! (:filePath item) count)
        ((:log-telemetry! adapters) {:type "nudge" :role role :handoffId (handoff-id (:filePath item)) :count count} now-ms))))
  ;; Do NOT call on-stuck-escalation! false here. Nudge is still inside a stuck
  ;; episode; clearing the escalation edge re-arms the stuck email on the next
  ;; alert and floods the human (especially under mono-router, where a dormant
  ;; role's in_process can sit forever while chase wakes the resident).
  nil)

(defn- clear-stale-nudge-counts! [held]
  (doseq [item held :when (pos? (:nudgeCount item))]
    (write-nudge-count! (:filePath item) 0)))

(defn- apply-claim-progress-check!
  "BL-528: Check each in_process item for idle-reclaim (no new commits).
   Initialises the .claim-progress.json sidecar on first sight, advances
   the reclaim counter when HEAD is unchanged past the timeout, and calls
   the appropriate adapter on :nudge / :bounce / :halt.
   Before counting reclaims: skip when the resident is working, the worktree
   has uncommitted work, or a mono-router dormant mailbox is stale; probe
   the agent once before the first reclaim.
   Returns true when a halt was triggered (caller should short-circuit)."
  [role held now-ms config adapters]
  (when-let [get-head (:get-role-head-commit adapters)]
    (let [current-commit (get-head role)
          claim-cfg      (select-keys config [:claim-idle-timeout-ms
                                              :role-idle-timeout-ms
                                              :probe-grace-ms
                                              :nudge-threshold
                                              :bounce-threshold
                                              :halt-threshold])
          agent-busy?    (when-let [f (:role-agent-busy? adapters)] (f role))
          worktree-dirty? (when-let [f (:role-worktree-dirty? adapters)] (f role))
          idle-ctx       (when-let [f (:claim-idle-context adapters)] (f role))
          halt-triggered (atom false)]
      (doseq [item held
              :when (not @halt-triggered)]
        (let [fp       (:filePath item)
              progress (or (read-claim-progress fp)
                           (claim-progress-lib/make-claim-progress current-commit now-ms))
              ctx      (merge {:role role
                               :agent-busy? (boolean agent-busy?)
                               :worktree-dirty? (boolean worktree-dirty?)}
                              (or idle-ctx {}))
              signal   (claim-progress-lib/evaluate-claim-idle-signal
                        progress current-commit now-ms claim-cfg ctx)]
          (case signal
            :progressed
            (write-claim-progress! fp (claim-progress-lib/make-claim-progress current-commit now-ms))

            :paused-dormant
            (write-claim-progress! fp (claim-progress-lib/pause-for-active-rotation progress now-ms))

            :probe-agent
            (let [elapsed-min (quot (max 0 (- now-ms (or (:claimAtMs progress) 0))) 60000)
                  p' (claim-progress-lib/mark-idle-probe progress now-ms)]
              (write-claim-progress! fp p')
              ((:log-telemetry! adapters)
               {:type "claim-idle-probe" :role role :handoffId (handoff-id fp)
                :elapsedMin elapsed-min}
               now-ms)
              (when-let [probe! (:send-claim-idle-probe! adapters)]
                (probe! role (claim-progress-lib/format-idle-probe-message
                              {:role role :elapsed-min elapsed-min}))))

            :claimed-idle
            (let [p'     (claim-progress-lib/increment-reclaims progress)
                  action (claim-progress-lib/decide-claim-idle-action (:reclaims p') claim-cfg)]
              (write-claim-progress! fp p')
              ((:log-telemetry! adapters)
               {:type "claim-idle" :role role :handoffId (handoff-id fp)
                :reclaims (:reclaims p') :action (name action)}
               now-ms)
              (case action
                :nudge
                (when (wake-role-delivered? adapters role)
                  (write-nudge-count! fp (inc (:nudgeCount item))))

                :bounce
                ((:on-claim-idle-bounce! adapters) role fp p')

                :halt
                (if (claim-progress-lib/should-refuse-claim-halt? ctx)
                  ((:log-telemetry! adapters)
                   {:type "claim-idle-halt-refused" :role role :handoffId (handoff-id fp)
                    :reason "resident-active-or-dormant-stale"}
                   now-ms)
                  (do (clear-claim-progress! fp)
                      ((:on-claim-idle-halt! adapters) role fp p')
                      (reset! halt-triggered true)))))

            :not-yet-overdue
            (when (nil? (read-claim-progress fp))
              (write-claim-progress! fp progress)))))
      @halt-triggered)))

(defn sweep-in-process! [role in-process-dir now-ms config adapters]
  (let [held (scan-in-process in-process-dir)]
    (if (empty? held)
      ((:on-stuck-escalation! adapters) role false)
      (let [nudge-count (apply max (map :nudgeCount held))
            action (decide-stuck-action ((:get-last-activity-ms adapters) role) nudge-count now-ms config)]
        (case action
          "nudge" (apply-stuck-nudge! role held adapters now-ms)
          ;; Alert arms escalation AND keeps attempting resume. Stopping wakes
          ;; at maxChases left mono-router dormant holders permanently starved
          ;; once chase-escalations.json flipped true (2026-08-03 hardender
          ;; in_process) — standing-pane packs can absorb the continued wake;
          ;; dormant rotate targets have no human-attachable session.
          "alert" (do ((:on-stuck-escalation! adapters) role true)
                      (apply-stuck-nudge! role held adapters now-ms))
          (do (clear-stale-nudge-counts! held)
              ((:on-stuck-escalation! adapters) role false)
              ;; BL-528: even when pane-activity looks healthy, check whether
              ;; the role's worktree HEAD has advanced since the claim.
              (apply-claim-progress-check! role held now-ms config adapters)))))))

(defn- apply-inbox-item-action! [role item action adapters now-ms]
  (case action
    "chased" (when ((:send-wake-up! adapters) role)
               (let [count (inc (:chaseCount item))]
                 (write-chase-count! (:filePath item) count now-ms)
                 ((:log-telemetry! adapters) {:type "chase" :role role :handoffId (handoff-id (:filePath item)) :count count} now-ms)))
    "respawned" (do ((:trigger-respawn! adapters) role)
                     ((:log-telemetry! adapters) {:type "respawn" :role role :handoffId (handoff-id (:filePath item)) :count (:chaseCount item)} now-ms))
    "dead-lettered" (let [dead (dead-letter-path (:filePath item))
                          sc (sidecar-path (:filePath item))]
                      (fs/move (:filePath item) dead {:replace-existing false})
                      (when (fs/exists? sc)
                        (fs/move sc (sidecar-path dead) {:replace-existing false}))
                      ((:log-dead-letter! adapters) role (:filePath item))
                      ((:log-telemetry! adapters) {:type "dead-letter" :role role :handoffId (handoff-id (:filePath item)) :count (:chaseCount item)} now-ms))
    ;; BL-499: a reaped duplicate is DELETED outright, never moved to
    ;; .dead - its work is already durably recorded in completed/ (that is
    ;; precisely what makes it "terminal"), so there is nothing here worth
    ;; preserving as a dead-letter artifact. Never chased (no wake-up, no
    ;; chaseCount bump) and never dead-lettered (no human-visible alarm) -
    ;; an "already-processed" telemetry event is the auditable trail,
    ;; mirroring BL-218's own dequeue-side "SKIPPED already-processed"
    ;; idiom one level up (this is the REMOVE half; ready_for_next_task.bb
    ;; is the SKIP half - see decide-item-action's own comment).
    "reaped" (do (handoff-lib/remove-sidecars-of! (:filePath item))
                 (fs/delete (:filePath item))
                 ((:log-telemetry! adapters) {:type "already-processed" :role role :handoffId (handoff-id (:filePath item)) :count (:chaseCount item)} now-ms))
    nil))

;; ── BL-232: orphaned chase/nudge sidecar reaping ────────────────────────
;; A sidecar (.chase.json/.nudge) is state ABOUT a handoff still waiting in
;; new/ - once the handoff itself leaves new/ (the normal dequeue path
;; drops it there, via handoff-lib/remove-sidecars-of! - see
;; ready_for_next_task.bb/ready_for_next_batch.bb), the sidecar is
;; meaningless. This sweep-time reaper is the backstop for anything that
;; slips past that (e.g. a stray sidecar left over from a layout
;; migration): it removes only a sidecar whose parent .handoff is NOT
;; present in the same directory, never touching a live sidecar (parent
;; still waiting) or any non-sidecar file.

(defn- sidecar-filename->parent-handoff-filename
  "'foo.handoff.chase.json' -> 'foo.handoff', or nil when filename does not
   end with a known sidecar suffix."
  [filename]
  (some (fn [suffix]
          (when (str/ends-with? filename suffix)
            (subs filename 0 (- (count filename) (count suffix)))))
        handoff-lib/sidecar-suffixes))

(defn orphaned-sidecar-filenames
  "Given every filename currently in an inbox/new/ directory, returns the
   sidecar filenames whose parent .handoff is NOT among them - safe to
   remove. Pure; the impure reap-orphaned-sidecars! below is a thin fs
   wrapper around this."
  [filenames]
  (let [names (set filenames)]
    (vec (filter (fn [filename]
                   (when-let [parent (sidecar-filename->parent-handoff-filename filename)]
                     (not (contains? names parent))))
                 filenames))))

(defn reap-orphaned-sidecars!
  "BL-232/BL-615: delete sidecar files whose parent .handoff is gone.
   Returns the orphan filenames reaped (for logging)."
  [dir]
  (if-not (fs/exists? dir)
    []
    (let [filenames (map fs/file-name (fs/list-dir dir))
          orphans (orphaned-sidecar-filenames filenames)]
      (doseq [orphan orphans]
        (fs/delete (fs/path dir orphan)))
      (vec orphans))))

;; BL-852: reuses handoff-lib/default-ambulance-held? (already in scope via
;; this file's own load-file of handoff_lib.bb, per the ticket's "no new
;; adapter wiring" note) - the SAME predicate the delivery/dequeue/rotation
;; sites already consult, never a second notion of held (invariant 3).
;; try/catch mirrors ambulance-lib's own BL-813 fix: a parcel that vanishes
;; or is mid-write between the scan and this read must not crash the sweep -
;; it just isn't provably held, so it falls through to the normal ladder
;; (fail OPEN, same posture as parcel-held?'s own empty-attribution case).
(defn item-ambulance-held? [file-path]
  (try
    (handoff-lib/default-ambulance-held? (slurp file-path))
    (catch Exception _ false)))

;; BL-1004 stall-alarm exemption (architect bounce 2026-08-21): a rework a
;; SIBLING seat worked, still inside cross_seat_claim_deadline_ms (age via
;; its enqueued_at/created_at header, never mtime), is DESIGNED to sit in
;; the stage queue for that seat - the claim path is deliberately deferring
;; it. Chasing it mid-window is the same false alarm the ambulance hold
;; already prevents, so it composes into the identical held? slot. Same
;; target-root convention as default-ambulance-held? above; same fail-open
;; try/catch posture - an unreadable state must never mute a real stall.
(defn stage-deferral-context
  "The swept role's per-seat worked-task sets plus the effective cross-seat
   deadline, read once per role sweep (never per item). A root with no
   roles.tsv, an unreadable conf, or any read error degrades to no seats /
   the default deadline, under which deferral-hold? is structurally false."
  [role]
  {:seat-worked-task-sets (try (handoff-lib/stage-seat-worked-task-sets role)
                               (catch Exception _ []))
   :deadline-ms (seat-affinity-lib/parse-cross-seat-claim-deadline-ms
                 (try (slurp (str (backlog-depth-lib/conf-file-path (handoff-lib/target-root))))
                      (catch Exception _ nil)))})

(defn item-deferral-held? [deferral-ctx file-path now-ms]
  (try
    (seat-affinity-lib/deferral-hold?
     {:type (handoff-lib/header-field file-path "type")
      :task (handoff-lib/header-field file-path "task")
      :seat-worked-task-sets (:seat-worked-task-sets deferral-ctx)
      :enqueued-at (handoff-lib/header-field file-path "enqueued_at")
      :created-at (handoff-lib/header-field file-path "created_at")
      :now-ms now-ms
      :deadline-ms (:deadline-ms deferral-ctx)})
    (catch Exception _ false)))

(defn sweep-role-inbox! [role inbox-new-dir completed-dir abandoned-dir now-ms config adapters]
  (reap-orphaned-sidecars! inbox-new-dir)
  (let [items (scan-inbox-new inbox-new-dir)
        ;; BL-499 (cleaner, DRY): handoff-lib/terminal-basenames - the SAME
        ;; flat (non-batch-recursing) completed/abandoned reader
        ;; ready_for_next_task.bb's own dequeue-time dedup (BL-218) already
        ;; uses - never a second, drifting notion of "what counts as
        ;; terminal". A non-existent directory (a role whose
        ;; completed/abandoned has never been created yet) already
        ;; degrades to [] there.
        completed-basenames (handoff-lib/terminal-basenames completed-dir)
        abandoned-basenames (handoff-lib/terminal-basenames abandoned-dir)
        liveness ((:get-liveness adapters) role)
        last-activity-ms ((:get-last-activity-ms adapters) role)
        respawn-cooldown-until-ms (read-respawn-cooldown-until-ms inbox-new-dir)
        ;; BL-1004: forced only if some non-terminal item actually needs the
        ;; hold check - an empty inbox costs no roles.tsv/conf/mailbox reads.
        deferral-ctx (delay (stage-deferral-context role))]
    (doseq [item items]
      (let [already-terminal? (handoff-lib/already-terminal?
                                (fs/file-name (:filePath item)) completed-basenames abandoned-basenames)
            ;; Only worth reading the file (and consulting the marker) when
            ;; it isn't already reaped outright - already-terminal? outranks
            ;; the hold, so there's nothing to protect either way.
            held? (and (not already-terminal?)
                       (or (item-ambulance-held? (:filePath item))
                           (item-deferral-held? @deferral-ctx (:filePath item) now-ms)))
            decided (decide-item-action (:mtimeMs item) (:chaseCount item) now-ms config
                                         liveness last-activity-ms (:lastChasedAtMs item) already-terminal? held?)
            action (if (and (= decided "respawned") (is-cooling-down? respawn-cooldown-until-ms now-ms))
                     "chased"
                     decided)]
        (apply-inbox-item-action! role item action adapters now-ms)
        (when (= action "respawned")
          (write-respawn-cooldown-until-ms! inbox-new-dir (+ now-ms (* (:respawnCooldownSeconds config) 1000))))))))

;; ── BL-209: rate-limit cooldown gate ─────────────────────────────────────
;; A role whose agent hit a provider usage limit must not be blind-retried
;; every sweep cycle into the same limit - it must wait until the reported
;; reset time, then be woken exactly once to resume. Mirrors the shape the
;; now-retired TS inboxChaser.ts's own runSweep already had (one shared,
;; role-keyed cooldown file - NOT chase_sweep_lib.bb's own per-role
;; respawn-cooldown.json convention above, which is a different concern:
;; that one throttles the daemon's OWN forced-respawn action; this one
;; reflects what the AGENT'S PROVIDER reported). The file shape mirrors
;; extension/src/swarm/cooldownScheduler.ts's CooldownFileState exactly
;; (role -> {untilMs, wokenForUntilMs}) so the extension (which detects and
;; records) and this daemon (which enforces) agree on one format without
;; either side rebuilding the other's logic.

(defn rate-limit-cooling-down?
  "True while now-ms is still before the recorded cooldown expiry - mirrors
   cooldownScheduler.ts's isCoolingDown exactly."
  [cooldown-until-ms now-ms]
  (and (number? cooldown-until-ms) (< now-ms cooldown-until-ms)))

(defn should-wake-on-rate-limit-expiry?
  "True exactly once per cooldown window: past expiry AND no wake yet
   recorded for this exact until-ms - mirrors cooldownScheduler.ts's
   shouldWakeOnExpiry exactly, including its rationale (comparing against
   until-ms, not just a boolean flag, so a LATER cooldown for the same role
   gets its own wake instead of being silenced by a stale marker)."
  [cooldown-until-ms now-ms woken-for-until-ms]
  (and (number? cooldown-until-ms)
       (>= now-ms cooldown-until-ms)
       (not= woken-for-until-ms cooldown-until-ms)))

(defn rate-limit-cooldown-path [state-dir]
  (str (fs/path state-dir "rate-limit-cooldown.json")))

(defn read-rate-limit-cooldown-state [state-dir]
  (or (read-json (rate-limit-cooldown-path state-dir)) {}))

(defn read-rate-limit-cooldown-until-ms [state-dir role]
  (get-in (read-rate-limit-cooldown-state state-dir) [(keyword role) :untilMs]))

(defn read-rate-limit-cooldown-woken-marker [state-dir role]
  (get-in (read-rate-limit-cooldown-state state-dir) [(keyword role) :wokenForUntilMs]))

;; Marks (not deletes) the entry, exactly like cooldownScheduler.ts's own
;; markCooldownWoken - the untilMs itself stays on record so a later, DIFFERENT
;; cooldown for the same role is still distinguishable from this one.
(defn mark-rate-limit-cooldown-woken! [state-dir role until-ms]
  (let [state (read-rate-limit-cooldown-state state-dir)
        role-kw (keyword role)]
    (when (contains? state role-kw)
      (spit (rate-limit-cooldown-path state-dir)
            (json/generate-string (update state role-kw assoc :wokenForUntilMs until-ms))))))

(defn- apply-rate-limit-expiry-wake! [role adapters cooldown-until-ms]
  (when ((:send-wake-up! adapters) role)
    ((:mark-rate-limit-cooldown-woken! adapters) role cooldown-until-ms)))

(defn- sweep-role! [role inbox-new-dir in-process-dir completed-dir abandoned-dir now-ms config adapters]
  ;; BL-615: reap orphaned claim-progress sidecars in in_process (backstop).
  (let [reaped (reap-orphaned-sidecars! in-process-dir)]
    (when (seq reaped)
      ((:log-telemetry! adapters)
       {:type "reap-orphaned-sidecar" :role role :orphans reaped}
       now-ms)))
  (sweep-in-process! role in-process-dir now-ms config adapters)
  (sweep-role-inbox! role inbox-new-dir completed-dir abandoned-dir now-ms config adapters))

(defn run-sweep!
  "role-inboxes: seq of {:role :inbox-new-dir :in-process-dir :completed-dir
   :abandoned-dir}. Does not own dead-letter recovery/escalation
   (handoffRecovery.ts) - deferred to a follow-up ticket rather than
   widening this parcel.
   adapters additionally requires (BL-209): :get-rate-limit-cooldown-until-ms
   (fn [role]), :get-rate-limit-cooldown-woken-marker (fn [role]),
   :mark-rate-limit-cooldown-woken! (fn [role until-ms])."
  [role-inboxes now-ms config adapters]
  (doseq [{:keys [role inbox-new-dir in-process-dir completed-dir abandoned-dir]} role-inboxes]
    (let [cooldown-until-ms ((:get-rate-limit-cooldown-until-ms adapters) role)]
      (when-not (rate-limit-cooling-down? cooldown-until-ms now-ms)
        (when (should-wake-on-rate-limit-expiry?
               cooldown-until-ms now-ms ((:get-rate-limit-cooldown-woken-marker adapters) role))
          (apply-rate-limit-expiry-wake! role adapters cooldown-until-ms))
        (sweep-role! role inbox-new-dir in-process-dir completed-dir abandoned-dir now-ms config adapters)))))

;; ── busy-vs-wedged respawn precheck (BL-137/BL-147 parity, BL-970 rework) ───
;; The daemon's own respawn action must never regress the exact incident
;; that motivated BL-147: typing into a pane that is genuinely mid-turn.
;;
;; BL-970: classification keys on the pane's RENDERED TURN STATE, never on
;; marker words found anywhere in the snapshot. The old anywhere-in-pane
;; word matching failed in both directions and was self-sustaining: (1)
;; FALSE-BUSY - persistent scrollback chrome (a backgrounded shell's
;; still-running task line, a busy-marker phrase quoted inside displayed
;; text) matched forever at an idle prompt, so no wake path ever fired and
;; nothing ever scrolled the marker away (QA sat unwakeable ~70 minutes,
;; evidence ecc14dd14); (2) FALSE-IDLE - the spinner-verb list was
;; hand-maintained and incomplete, so a live frame with an unlisted verb
;; and no token counter read idle and would be typed into mid-turn (the
;; compute-the-closure lesson applied to a verb list).
;;
;; The one reliable signal is the LIVE STATUS FRAME Claude Code renders
;; while (and only while) a turn is in flight, and its shape is
;; structural, not lexical:
;;
;;     <spinner glyph> <Verb words><ellipsis> (<digit-led elapsed ...>
;;
;; e.g. a one-word or multi-word verb, any verb at all - no verb list. The
;; finished-turn footer ("Worked for Xs ...") has no ellipsis-paren; a
;; transcript bullet (⏺/⎿ - excluded from the glyph class) quoting frame-
;; like text does not start with a spinner glyph; a backgrounded shell's
;; chrome line has no glyph+frame shape. Two independent layers:
;;   - STRUCTURE: only a frame-shaped line classifies busy.
;;   - ZONE: only the snapshot's tail window is consulted - the frame (and
;;     the idle prompt) live in the footer zone, so even a byte-perfect
;;     frame line quoted deep in scrollback cannot false-busy a pane whose
;;     tail shows an idle prompt.
;; Both BL-970 invariants fall out: an idle prompt with any scrollback
;; content is never busy, and a live frame with any (unlisted) verb always
;; is. An empty/unreadable capture classifies idle - an unreadable pane
;; must never block a wake (the feature's empty-capture contract).

(def ^:private busy-tail-window
  "How many trailing snapshot lines the classifier consults - generously
   larger than the footer zone (frame + prompt + permission chrome span
   ~8 lines) while still excluding the scrollback body."
  20)

(def live-status-frame-pattern
  ;; <spinner glyph (not a transcript bullet ⏺/⎿, not a quote/bracket)>
  ;; <verb word(s)> <… or ...> (<digit-led elapsed>
  #"^\s*[^\sA-Za-z0-9(){}\[\]\"'⏺⎿]{1,2}\s+\p{L}[\p{L} -]{0,60}(?:…|\.{3})\s*\(\s*\d")

(defn live-status-frame-line? [line]
  (boolean (re-find live-status-frame-pattern (or line ""))))

(defn actively-processing? [pane-text]
  (let [lines (str/split-lines (or pane-text ""))
        tail (take-last busy-tail-window lines)]
    (boolean (some live-status-frame-line? tail))))

;; ── durable needs-human escalation state (crosses the daemon/extension-host
;; process boundary now that the daemon, not the extension host, decides it) ─

(defn escalations-path [daemon-dir]
  (str (fs/path daemon-dir "chase-escalations.json")))

(defn read-escalations [daemon-dir]
  (or (read-json (escalations-path daemon-dir)) {}))

(defn write-escalation! [daemon-dir role escalated?]
  (let [current (read-escalations daemon-dir)
        updated (if escalated? (assoc current (keyword role) true) (dissoc current (keyword role)))]
    (spit (escalations-path daemon-dir) (json/generate-string updated))))

;; ── BL-222: dispatch-gap detection + auto-route ─────────────────────────────
;; A promoted backlog/active/ item can sit with zero routing handoff ever
;; sent to its assigned_to - the sweep above only watches INBOX mail
;; (queued/in_process handoffs); never-dispatched work produces no inbox
;; mail at all, so it was invisible (BL-217: sat ~3h with no alert).
;; decide-dispatch-gaps is the pure, independently-testable core: given the
;; active-item list and the set of ticket ids already known to have SOME
;; handoff trail anywhere (any mailbox state, any role - proof of dispatch
;; even if the item has since progressed past its original assignee), it
;; returns exactly the items with no trail at all. The scanning functions
;; below assemble that trail set from a real (or fixture) mailbox tree;
;; they do real fs I/O like scan-inbox-new above, but are still pure enough
;; to unit test directly against a fixture directory - no live swarm.

(defn decide-dispatch-gaps
  "active-items: seq of {:id :assigned-to}. dispatched-ids: set of ticket
   ids (e.g. #{\"BL-217\"}) already seen in some handoff's task/message
   header anywhere. Returns the subset of active-items with no dispatch
   trail at all - these need auto-routing."
  [active-items dispatched-ids]
  (vec (remove #(contains? dispatched-ids (:id %)) active-items)))

;; BL-488-VIOLATION: an ALLOWLIST, never a denylist - mirrors
;; pipeline_stage_lib.bb's own known-ticket-prefixes exactly (this codebase's
;; own "small live-glue duplicated across independent pure libs" posture, see
;; that file's comment). The only ticket-id prefixes this project actually
;; mints: "BL-" for swarm-numbered tickets, "GH-" for a GitHub-issue-seeded
;; ticket. An unbounded [A-Za-z]+ prefix cannot be safely disambiguated from
;; a GLUED prefix: a leading run of letters has no internal boundary to
;; reject at, so greedy [A-Za-z]+ anchored at string-start absorbs the WHOLE
;; run - "ABL-217 active..." would extract "ABL-217" as if "ABL" were the
;; ticket's own prefix, silently swallowing the real "BL-217" reference and
;; feeding a wrong/non-existent id into collect-dispatched-ticket-ids, which
;; can misreport a genuinely-dispatched ticket as gapped (or vice versa) -
;; the exact "durable false" failure mode BL-217/BL-222 exist to close, just
;; reached a different way through this sweep's own leading-token extractor.
(def known-ticket-prefixes ["BL" "GH"])

;; BL-503: the prefix hyphen is OPTIONAL (`-?`) - ~14 in-flight coder tickets
;; were minted with a no-hyphen task name ("blNNN", e.g.
;; "bl493-fold-ticket-events"), which the previously-mandatory hyphen
;; resolved to nil. Two capture groups (prefix, digits) so the match can be
;; canonicalized below - mirrors pipeline_stage_lib.bb's own ticket-id-pattern.
(def ^:private leading-ticket-id-pattern
  (re-pattern (str "(?i)^(" (str/join "|" known-ticket-prefixes) ")-?(\\d+)")))

;; Spec/Work notes conventionally put the verb first ("Spec BL-538 …"), so a
;; leading-only extractor misses them and BL-222 dispatch-gap re-fires a
;; redundant "no dispatch on record" auto-route while the Spec note already
;; sits in the assignee inbox (live 2026-07-19 BL-538 stall).
(def ^:private spec-work-ticket-id-pattern
  (re-pattern (str "(?i)\\b(?:Spec|Work)\\s+("
                   (str/join "|" known-ticket-prefixes)
                   ")-?(\\d+)\\b")))

(defn extract-ticket-id
  "The leading <PREFIX>-<digits> token from a task or message field (e.g.
   \"BL-217\" from \"BL-217-inbound-email-webhook\" or from a routing
   note's own \"BL-217 active, spec-complete...\" message text - every
   routing note in this swarm conventionally leads with the ticket id).
   Also recognizes \"Spec BL-###\" / \"Work BL-###\" (verb-first Spec/Work
   notes) so dispatch-gap does not treat an already-specced ticket as
   never-dispatched.
   Matched against known-ticket-prefixes above, never an unbounded
   [A-Za-z]+, so a stray letter glued directly in front of a real id
   (\"ABL-217 ...\") resolves to nil instead of swallowing it. The prefix
   hyphen is optional (BL-503), and every match is canonicalized to
   upper-case hyphenated form regardless of the input's own case/hyphenation
   (BL-503: this extractor used to return the raw match un-canonicalized, so
   a lower-case hyphenated id, e.g. \"bl-493\", silently failed the
   case-sensitive active-set join downstream - mirrors pipeline_stage_lib.bb's
   own BL-471 canonicalization)."
  [text]
  (when text
    (or
     (when-let [[_ prefix digits] (re-find leading-ticket-id-pattern text)]
       (str/upper-case (str prefix "-" digits)))
     (when-let [[_ prefix digits] (re-find spec-work-ticket-id-pattern text)]
       (str/upper-case (str prefix "-" digits))))))

(defn- list-handoff-files [dir]
  (if-not (fs/exists? dir)
    []
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")))
         (map str))))

(defn- list-batch-dirs [dir]
  (if-not (fs/exists? dir)
    []
    (->> (fs/list-dir dir)
         (filter #(and (fs/directory? %) (str/starts-with? (fs/file-name %) "batch_")))
         (map str))))

;; Direct .handoff files in dir, plus files inside any batch_* subdirectory
;; (one level, never deeper) - a batch role moves a whole completed/
;; in_process batch into one such subdirectory (mirrors handoff_lib.bb's
;; own batch-aware readers).
(defn- list-handoff-files-with-batches [dir]
  (concat (list-handoff-files dir) (mapcat list-handoff-files (list-batch-dirs dir))))

(def ^:dynamic *read-handoff-file*
  "BL-978 instrumentation seam: the ONE function through which ANY sweep
   code reads a handoff file's bytes - both the single-pass index and the
   older per-field readers below. Tests bind a counting wrapper to assert
   the read-each-file-once invariant over the whole sweep, so a regression
   back to per-item scanning cannot hide from the counter; production is
   plain slurp."
  slurp)

(defn- read-header-field [file-path field]
  (let [header (first (str/split (*read-handoff-file* file-path) #"\n\n" 2))
        prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (subs line (count prefix))))
          (str/split-lines header))))

(defn- dispatch-ticket-ref
  "A handoff file's own ticket reference for the general 'does this handoff
   MENTION this ticket' question (live-mail membership, stale-claim
   labelling): its task header (git_handoff) if present, else its message
   header (note) - both conventionally lead with the ticket id. Deliberately
   broad - never narrowed for BL-1223, which is about the narrower DISPATCH
   question only (see dispatch-trail-ticket-id below)."
  [file-path]
  (or (read-header-field file-path "task") (read-header-field file-path "message")))

(defn dispatch-trail-ticket-id
  "BL-1223: the id a handoff contributes to the DISPATCH TRAIL specifically
   - narrower than dispatch-ticket-ref/extract-ticket-id's own general
   'does this handoff mention this ticket' question, which a mention-only
   note (a spec-ready announcement, a coordinator's own gap alarm) also
   satisfies because routing notes conventionally lead with the ticket id
   too. Measured incident: the specifier's mandated spec-ready note and the
   coordinator's own 'no parcel in flight' self-alarm both counted as
   dispatch evidence under the old broad match - in BL-1203's case, the
   REPORT of a dispatch gap was itself counted as proof there was none.

   `task:` is structural - only a git_handoff carries one, and its value is
   a stable task name - so it counts via the full extractor unchanged.
   `message:` (note-only) counts ONLY the router's own verb-first Spec/Work
   form (spec-work-ticket-id-pattern, BL-538) - never the general leading-id
   match a mention-only note also satisfies. Unclassifiable forms answer
   nil (undispatched) rather than guessing - failing loud beats failing
   silent, this module's own stated posture; a second route is visible and
   recoverable, a starved ticket is neither."
  [{:keys [task message]}]
  (if (not (str/blank? task))
    (extract-ticket-id task)
    (when message
      (when-let [[_ prefix digits] (re-find spec-work-ticket-id-pattern message)]
        (str/upper-case (str prefix "-" digits))))))

(defn- dispatch-trail-headers [file-path]
  {:task (read-header-field file-path "task") :message (read-header-field file-path "message")})

(defn collect-dispatched-ticket-ids
  "Scans every given directory path for .handoff files (including one level
   of batch_* subdirectories) and returns the set of ticket ids that
   genuinely DISPATCH work per dispatch-trail-ticket-id - never a handoff
   that merely mentions the ticket (BL-1223)."
  [dirs]
  (->> dirs
       (mapcat list-handoff-files-with-batches)
       (map dispatch-trail-headers)
       (keep dispatch-trail-ticket-id)
       set))

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn- read-active-item [yaml-file]
  (let [content (slurp (str yaml-file))]
    {:id (read-yaml-field content "id")
     :assigned-to (read-yaml-field content "assigned_to")
     ;; BL-1301: carried for the dropped-parcel decision's park check only.
     ;; Reading it here is additive - no sweep FILTERS on it in this shared
     ;; reader, so the dispatch-gap and unassigned-active candidate sets are
     ;; byte-identical to before (BL-1301 invariant 2).
     :status (read-yaml-field content "status")}))

;; BL-1093: shared "names nobody" predicate — must sit above read-active-items
;; / dispatch-gap-draft-lines (SCI resolves symbols at analysis time).
(def nobody-assignee-spellings
  "Live-corpus spellings of 'names nobody' (BL-1047 measured; BL-1093
   normalises). Absent/nil and blank are handled separately by
   nobody-assigned? — these are the present-but-nobody string forms."
  #{"none" "unassigned"})

(defn nobody-assigned?
  "True when assigned_to is absent, blank, or a known nobody spelling
   (case-insensitive). Shared by read-active-items and
   read-unassigned-active-items so exactly one sweep claims each ticket."
  [assigned-to]
  (or (nil? assigned-to)
      (str/blank? assigned-to)
      (contains? nobody-assignee-spellings (str/lower-case (str/trim assigned-to)))))

(defn read-active-items
  "Every backlog/active/*.yaml item with an id and a REAL assignee —
   items missing an id, or whose assigned_to names nobody (absent/blank/
   none/unassigned), are not dispatch-gap candidates (BL-1093: those belong
   to the unassigned-active nudge, never auto-route)."
  [active-dir]
  (if-not (fs/exists? active-dir)
    []
    (->> (fs/list-dir active-dir)
         (filter #(str/ends-with? (fs/file-name %) ".yaml"))
         (map read-active-item)
         (filter #(and (:id %) (not (nobody-assigned? (:assigned-to %)))))
         vec)))

(defn dispatch-gap-items
  "Full pipeline for one evaluation: reads active items from active-dir and
   the dispatched-ticket-id set from scan-dirs, returning exactly the items
   needing auto-route. decide-dispatch-gaps above remains the independently
   pure/testable core."
  [active-dir scan-dirs]
  (decide-dispatch-gaps (read-active-items active-dir) (collect-dispatched-ticket-ids scan-dirs)))

;; ── BL-1097: the ROUTER's half of the same question ────────────────────────
;; Article 1.9 forbids FORWARDING a parcel whose commit produces no functional
;; change. The coordinator's router (route_backlog_to_coder.sh, and
;; promote_and_route_next.sh through it) ORIGINATES one, and nothing stopped
;; it re-originating a parcel for work already finished: a ticket stays in
;; backlog/active/ with its mint `status: todo` and its `assigned_to` from the
;; moment it is promoted until the coordinator's separate bookkeeping step
;; moves it to backlog/done/, and nothing in swarmforge/scripts/ writes
;; `status:` at all. For that whole window finished work is indistinguishable
;; from unstarted work to the router. Measured 2026-08-23: four such routes in
;; about an hour, and on BL-973 the receiving coder did not notice, and built a
;; second complete rival implementation.
;;
;; The ticket's second invariant is that the router and the BL-222 sweep above
;; must not hold contradictory answers to "has this ticket been dispatched?".
;; That is met here by DEFINITION rather than by discipline: ticket-dispatched?
;; is decide-dispatch-gaps, asked about one ticket. There is one predicate, so
;; there is nothing to keep in sync and no way for the two to drift. Do not
;; "optimise" it into a bare contains? - that would recreate the second copy
;; the invariant exists to forbid, and it would silently diverge the first time
;; decide-dispatch-gaps learns a nuance (id canonicalization, say).

(defn ticket-dispatched?
  "True when ticket-id already has a dispatch trail in dispatched-ids - i.e.
   the router must NOT originate another parcel for it. Literally
   decide-dispatch-gaps asked about a single ticket, so the router's answer and
   the sweep's answer are the same answer (BL-1097 invariant 2)."
  [ticket-id dispatched-ids]
  (empty? (decide-dispatch-gaps [{:id ticket-id}] dispatched-ids)))

;; The mailbox states a sent parcel can be sitting in. This list used to live
;; privately inside handoffd.bb's dispatch-gap-scan-dirs; it moved here so the
;; router reads the SAME directories the sweep does. A router scanning fewer
;; states would answer "undispatched" for a ticket the sweep knows about, which
;; is the contradiction invariant 2 forbids - and it would do so silently.
(def dispatch-trail-states [:new :in_process :completed :sent :outbox])

(defn dispatch-trail-dirs
  "Every mailbox directory that counts as proof of dispatch, for the given
   role-infos (handoff-lib/load-all-roles shape, or the vals of handoffd's own
   roles map). Paths are resolved through handoff-lib/mailbox-dir - the one
   shared resolver (BL-128) - never rebuilt here."
  [role-infos]
  (vec (for [role-info role-infos
             state dispatch-trail-states]
         (str (handoff-lib/mailbox-dir role-info state)))))

(defn ticket-dispatched-in?
  "Full pipeline for the router's one-ticket question: reads the trail set from
   scan-dirs with the SAME reader the sweep uses, then answers for ticket-id."
  [ticket-id scan-dirs]
  (ticket-dispatched? ticket-id (collect-dispatched-ticket-ids scan-dirs)))

(def dispatch-gap-note-max-length 80)

(defn dispatch-gap-note-message
  "Legacy soft-note text (kept for callers/tests that still assert the phrase).
   Production auto-route now emits a git_handoff via dispatch-gap-draft-lines
   when a HEAD commit is supplied."
  [item-id]
  (str item-id " is active with no dispatch on record - auto-routed by the sweep."))

(defn dispatch-gap-draft-lines
  "The swarm_handoff.sh draft for one auto-route — a real git_handoff so the
   assignee gets merge_and_process + a task id, not a soft note the agent
   can narrate and idle on. `commit` must already be the 10-char HEAD
   abbreviation swarm_handoff.bb validates. handoffd.bb's auto-route!
   supplies HEAD. Without a commit, falls back to the legacy soft note so a
   dispatch trail still lands rather than silently dropping.
   BL-1093 belt-and-braces: never emit a draft whose recipient names nobody
   (read-active-items already excludes these; empty return if called anyway)."
  ([item] (dispatch-gap-draft-lines item nil))
  ([item commit]
   (when-not (nobody-assigned? (:assigned-to item))
     (if (str/blank? commit)
       ["type: note"
        (str "to: " (:assigned-to item))
        "priority: 00"
        (str "message: " (dispatch-gap-note-message (:id item)))]
       ["type: git_handoff"
        (str "to: " (:assigned-to item))
        "priority: 00"
        (str "task: " (:id item))
        (str "commit: " commit)]))))

;; ── Unassigned-active coordinator nudge ─────────────────────────────────────
;; Sibling of BL-222 dispatch-gap: an active/*.yaml with an id but NO
;; assigned_to is invisible to read-active-items / auto-route (those require
;; an assignee). Without a nudge, the ticket sits at board NS forever while
;; the coordinator idles on mailbox NO_TASK (it must not self-poll). The
;; durable close is: the daemon notices unassigned actives with no handoff
;; trail yet and drops a note on the COORDINATOR so *it* assigns + routes —
;; never inventing assigned_to here (constitution: intake/routing is the
;; coordinator's exclusive duty).

(defn read-unassigned-active-items
  "Every backlog/active/*.yaml with an id whose assigned_to names nobody
   (absent, blank, none, unassigned). These need a coordinator nudge, not
   an assignee auto-route (BL-1093)."
  [active-dir]
  (if-not (fs/exists? active-dir)
    []
    (->> (fs/list-dir active-dir)
         (filter #(str/ends-with? (fs/file-name %) ".yaml"))
         (map read-active-item)
         (filter #(and (:id %) (nobody-assigned? (:assigned-to %))))
         vec)))

(defn unassigned-active-items
  "Unassigned actives that still have no handoff trail anywhere — same
   decide-dispatch-gaps core as BL-222, different input set."
  [active-dir scan-dirs]
  (decide-dispatch-gaps (read-unassigned-active-items active-dir)
                        (collect-dispatched-ticket-ids scan-dirs)))

(defn unassigned-active-note-message
  "BL-1223: leads with the router's own verb-first 'Work' marker (matching
   spec-work-ticket-id-pattern) so the next sweep still treats the nudge
   itself as a trail (no spam) under the narrowed dispatch predicate - a
   bare leading id (the pre-BL-1223 form) no longer counts as a dispatch,
   which would otherwise turn this sweep's own anti-spam mechanism into a
   spam generator. Coordinator must then assign_to + route; we never set
   assigned_to from this sweep."
  [item-id]
  (let [msg (str "Work " item-id " active unassigned - assign_to and route it.")]
    (if (<= (count msg) dispatch-gap-note-max-length)
      msg
      (subs msg 0 dispatch-gap-note-max-length))))

(defn unassigned-active-draft-lines
  "Note to the coordinator only — never to coder/specifier. Assignment is
   the coordinator's job."
  [item]
  ["type: note"
   "to: coordinator"
   "priority: 00"
   (str "message: " (unassigned-active-note-message (:id item)))])

;; ── Open-slot coordinator nudge (sibling of unassigned-active) ──────────────
;; Empty/under-cap active/ + eligible paused/ is invisible to BL-222 (which
;; only sees already-active tickets). The daemon notices and drops a note on
;; the COORDINATOR to promote+route — never git-mv'ing paused→active itself
;; (constitution: intake remains coordinator-owned; do not reintroduce
;; BL-226 receive-path auto-promote).

(def open-slot-nudge-phrase "open slot + paused work - promote+route")

(def open-slot-nudge-cooldown-ms
  "Default 5 minutes between open-slot nudges when no pending note remains."
  (* 5 60 1000))

(defn human-approval-awaiting?
  "True only when human_approval is PRESENT and not the literal approved.
   Absent means not applicable (passes the gate) and must NOT read as awaiting."
  [content]
  (let [v (promotion-gates-lib/read-human-approval content)]
    (boolean (and v (not= "approved" v)))))

(defn open-slot-nudge-message
  "0-arg: the old fixed, ticketless phrase (kept for callers with no
   candidate yet known — the trail/cooldown dedup keys off this phrase as a
   prefix regardless of arity, see open-slot-nudge-pending? below).
   1-arg (BL-798 invariant 1): names the top Article-3.2.4 candidate and its
   approval state — never a ticketless generic poke once a candidate is
   known. nil candidate falls back to the plain phrase (defensive only:
   decide-open-slot-nudge? already requires a positive paused-eligible-count
   before this is ever called with a real candidate in production).
   Truncated to the 80-char handoff `message:` limit, same discipline as
   unassigned-active-note-message."
  ([] open-slot-nudge-phrase)
  ([candidate]
   (if (nil? candidate)
     open-slot-nudge-phrase
     (let [msg (str open-slot-nudge-phrase ": " (:id candidate)
                    (when (:approval-awaiting? candidate) " awaiting approval"))]
       (if (<= (count msg) dispatch-gap-note-max-length)
         msg
         (subs msg 0 dispatch-gap-note-max-length))))))

(defn decide-open-slot-nudge?
  "Pure decision: capacity under cap, at least one eligible paused ticket,
   no pending open-slot note still sitting in coordinator new/in_process,
   not within the post-send cooldown window, and (BL-679) the mode is not
   engaged - ambulance's promotion freeze holds paused/ in place for the
   ride's duration, so the nudge that would otherwise ask the coordinator to
   fill an open slot must not fire while it is."
  [active-count cap paused-eligible-count {:keys [pending-nudge? within-cooldown? ambulance-active?]
                                           :or {pending-nudge? false within-cooldown? false ambulance-active? false}}]
  (and (number? active-count)
       (number? cap)
       (backlog-depth-lib/under-depth-cap? active-count cap)
       (pos? (long (or paused-eligible-count 0)))
       (not pending-nudge?)
       (not within-cooldown?)
       (not ambulance-active?)))

(defn count-backlog-yaml
  "Count *.yaml tickets in a backlog folder (active/ or paused/). Ignores
   non-yaml (e.g. .gitkeep)."
  [dir]
  (if-not (fs/exists? dir)
    0
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".yaml")))
         count)))

(defn open-slot-nudge-pending?
  "True when any handoff in scan-dirs carries the open-slot nudge phrase in
   its message header (pending mail = do not spam another)."
  [scan-dirs]
  (->> scan-dirs
       (mapcat list-handoff-files-with-batches)
       (keep #(read-header-field % "message"))
       (some #(and % (str/includes? % open-slot-nudge-phrase)))
       boolean))

(defn within-open-slot-cooldown?
  "True when last-sent-ms is within cooldown-ms of now-ms."
  [last-sent-ms now-ms cooldown-ms]
  (and (number? last-sent-ms)
       (number? now-ms)
       (number? cooldown-ms)
       (<= 0 (- now-ms last-sent-ms) cooldown-ms)))

(defn open-slot-nudge-draft-lines
  "Note to the coordinator only — never promotes or routes to coder. 1-arg
   names the top candidate (BL-798 invariant 1); 0-arg keeps the prior
   ticketless phrase for callers with no candidate."
  ([] (open-slot-nudge-draft-lines nil))
  ([candidate]
   ["type: note"
    "to: coordinator"
    "priority: 00"
    (str "message: " (open-slot-nudge-message candidate))]))

;; ── BL-798: candidate ranking + promotion-inaction escalation ──────────────
;; SUP-1 (2026-08-03): a ticketless nudge was treated as noise and cleared
;; without ever promoting. Two fixes: (1) name the top Article-3.2.4
;; candidate so every nudge is concrete, never identical-looking; (2) track
;; repeated unacted nudges for the SAME candidate and escalate past a
;; bounded count rather than repeating forever. Mirrors
;; provider_auth_observe_lib.bb's own episode-state shape exactly
;; (bounded-count-then-alert-once, pure, restart-safe to keep in-memory).

(defn read-paused-candidates
  "Every backlog/paused/*.yaml as {:file :content} — the shape
   promotion-gates-lib/rank-candidates expects."
  [paused-dir]
  (if-not (fs/exists? paused-dir)
    []
    (->> (fs/list-dir paused-dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".yaml")))
         (map (fn [f] {:file f :content (slurp (str f))}))
         vec)))

(defn- sole-refusal-is-approval?
  "BL-963 bounce D1: evaluate is first-failing-gate-wins with human_approval
   BEFORE depends_on (BL-957's deliberate order), so a reported
   human_approval refusal says NOTHING about the later gates - a candidate
   both pending approval and dep-blocked reports human_approval, yet
   approving it promotes nothing. The sole-refusal question is answered by
   the SAME chain, never a rival gate re-statement (BL-663): re-evaluate the
   candidate with its human_approval field satisfied - ok iff approval was
   the only thing standing. The line rewrite is an input transformation only;
   the DECISION still belongs to evaluate. The field is guaranteed present
   here (the human_approval gate only fires on a present non-approved value),
   so the anchored line replace always has a line to hit."
  [evaluate-ctx content]
  (:ok (promotion-gates-lib/evaluate
        (merge evaluate-ctx
               {:content (str/replace content #"(?m)^human_approval:[^\n]*" "human_approval: approved")
                :held? false}))))

(defn nudge-eligible-candidates
  "BL-963: the paused candidates the open-slot nudge may NAME, COUNT toward
   its fire decision, or ACCRUE escalation state on - decided by the SAME
   promotion_gates evaluate chain promotion uses, never a second
   implementation (BL-663; invariant 1). A candidate the chain refuses for
   any reason OTHER than human_approval (depends_on once BL-957 landed,
   depth, hold, and any gate added later - inherited for free through the
   chain) is excluded entirely: promoting or approving it cannot succeed,
   and repeated nudges naming it are exactly the eternal-nudge shape SUP-1
   escalation was built to bound. A candidate whose SOLE refusal is
   human_approval stays eligible and is named flagged awaiting approval -
   approving is the human's own next action (BL-798 scenario 03's
   surface-not-skip ruling; invariant 2). Sole means sole: a reported
   human_approval refusal is only the FIRST failing gate, so eligibility
   re-asks the chain with approval satisfied (bounce D1) - a candidate also
   dep-blocked (or refused by any later gate) is excluded like any other
   chain-refused candidate.

   evaluate-ctx is the caller-supplied {:active-count :max-depth
   :active-epics :done-ids} snapshot; :held? is always false here (paused/
   candidates by construction, hold/ never enters this scan)."
  [candidates evaluate-ctx]
  (filterv (fn [{:keys [content]}]
             (let [verdict (promotion-gates-lib/evaluate
                            (merge evaluate-ctx {:content content :held? false}))]
               (or (:ok verdict)
                   (and (= "human_approval" (:gate verdict))
                        (sole-refusal-is-approval? evaluate-ctx content)))))
           candidates))

(defn top-open-slot-candidate
  "The single Article-3.2.4-best candidate among the given candidates —
   {:id .. :approved? bool :approval-awaiting? bool}, or nil when candidates
   is empty. :approved? is true only when human_approval reads approved;
   :approval-awaiting? is true only when human_approval is present and not
   approved (absent is neither — promotion passes and the nudge must not
   say awaiting approval). A sole pending-approval candidate is still named
   as the top candidate, flagged awaiting approval rather than silently
   skipped (BL-798 scenario 03). BL-900/BL-963: epic-index,
   defaulted to {} when omitted (mirrors promotion-gates-lib/rank-candidates'
   own default - a candidate with no epic: field, or whose epic has no
   tracker, ranks by its own priority exactly as before BL-900), is threaded
   through to rank-candidates, and the caller passes candidates already
   filtered through nudge-eligible-candidates above - so this candidate
   matches the one promotion actually picks, gate refusals included."
  ([candidates] (top-open-slot-candidate candidates {}))
  ([candidates epic-index]
   (when-let [winner (promotion-gates-lib/rank-candidates candidates epic-index)]
     (let [content (:content winner)
           ha (promotion-gates-lib/read-human-approval content)]
       {:id (or (promotion-gates-lib/read-id content) (fs/file-name (:file winner)))
        :approved? (= "approved" ha)
        :approval-awaiting? (human-approval-awaiting? content)}))))

(defn top-expedited-paused-candidate
  "BL-679: the id of the single Article-3.2.4-best EXPEDITED (defect/bug,
   severity critical|high) candidate among paused candidates, or nil when
   none are expedited. The promotion freeze holds an expedited defect filed
   mid-ambulance in paused/ like everything else (the one place the mode
   outranks Article 3.2.4) - this is what the auto-exit sweep's release
   announcement consults to name it FIRST, rather than let it go silently
   unmentioned among everything else that queued. BL-900: epic-index,
   defaulted to {} when omitted, is threaded through to rank-candidates so
   that WITHIN the expedited bucket, epic priority breaks ties before own-
   priority, same as top-open-slot-candidate above."
  ([candidates] (top-expedited-paused-candidate candidates {}))
  ([candidates epic-index]
   (when-let [winner (promotion-gates-lib/rank-candidates
                      (filter #(promotion-gates-lib/expedited? (:content %)) candidates)
                      epic-index)]
     (or (promotion-gates-lib/read-id (:content winner)) (fs/file-name (:file winner))))))

(def open-slot-escalation-default-threshold
  "BL-798 approval_context default: 3 unacted nudges for the same top
   candidate escalates. Amendable via swarmforge.conf."
  3)

(defn parse-open-slot-escalation-threshold
  "Pure: `config open_slot_escalation_threshold <n>` from conf text. Honors
   a POSITIVE integer only — absent, malformed, zero, and negative all
   degrade to the default (mirrors provider-auth-observe-lib/parse-max-
   attempts's own degrade-to-default failure mode)."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config open_slot_escalation_threshold"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) n open-slot-escalation-default-threshold)))

(defn next-open-slot-escalation-state
  "Advance the per-candidate unacted-nudge count. A different (or newly nil)
   top candidate resets the count — it tracks repeated nudges for the SAME
   unpromoted candidate, not a lifetime total; promoting the prior top
   candidate (or a higher-ranked one appearing) must not carry its
   predecessor's count forward."
  [prev candidate-id]
  (cond
    (nil? candidate-id) nil
    (= candidate-id (:candidate-id prev)) (update prev :count inc)
    :else {:candidate-id candidate-id :count 1 :escalated false}))

(defn decide-open-slot-escalation
  "Pure decision for one nudge-worthy sweep tick. Returns {:state ..
   :action ..}, action one of :nudge | :escalate | :none.
   - No candidate: :none.
   - Below threshold: :nudge, counted.
   - At/above threshold, not yet escalated for this candidate: :escalate
     once (invariant 2/3 — reaches the operator).
   - At/above threshold, already escalated: :none — no repeat escalation
     and no further identical silent nudge (BL-798 scenario 04), quiet
     until the candidate changes."
  ([prev candidate-id] (decide-open-slot-escalation prev candidate-id open-slot-escalation-default-threshold))
  ([prev candidate-id threshold]
   (let [state (next-open-slot-escalation-state prev candidate-id)]
     (cond
       (nil? state) {:state state :action :none}
       (< (:count state) threshold) {:state state :action :nudge}
       (not (:escalated state)) {:state (assoc state :escalated true) :action :escalate}
       :else {:state state :action :none}))))

(defn open-slot-escalation-reason
  "Standing evidence text — same role as loop_detect_lib's format-halt-
   reason / provider-auth-observe-lib's format-alert-reason."
  [candidate-id nudge-count]
  (str "Open-slot promotion inaction: '" candidate-id "' has been the top "
       "eligible paused candidate through " nudge-count " unacted open-slot "
       "nudges with the slot still open (BL-798). Promote it or record why "
       "it is blocked."))

(defn open-slot-escalation-telegram-text
  "Standing Operator-topic text (telegram-reply-outbox.jsonl threadId OPERATOR)."
  [candidate-id nudge-count]
  (str "⚠️ Open slot unfilled through " nudge-count " nudges — top candidate `"
       candidate-id "` still not promoted."))

(defn open-slot-escalation-email-subject
  [candidate-id]
  (str "SwarmForge: promotion inaction on " candidate-id " - open slot unfilled"))

;; ── BL-719: dropped-parcel coordinator nudge (sibling of BL-222) ───────────
;; BL-222's dispatch-gap sweep answers exactly one question: was this ticket
;; EVER dispatched. Any trail at all - even a note whose message text merely
;; contains the id - marks it dispatched forever, so a ticket dispatched
;; once and then dropped mid-pipeline (BL-714) has no detector: it sits in
;; backlog/active/ with nothing to wake it. This sweep asks the different
;; question: does the item have a trail (dispatch-gap already silent on it)
;; but NO parcel currently in flight anywhere, with that gap stale enough to
;; be a drop rather than an ordinary pause between stages? Reports to the
;; coordinator only - never routes, assigns, or promotes (constitution:
;; routing judgement is the coordinator's exclusive duty).

(def dropped-parcel-nudge-phrase "no parcel in flight - possible drop")

(defn dropped-parcel-note-message
  "Leads with the ticket id (swarm convention) so the note is unambiguous
   and self-identifying in the trail."
  [item-id]
  (let [msg (str item-id " " dropped-parcel-nudge-phrase ".")]
    (if (<= (count msg) dispatch-gap-note-max-length)
      msg
      (subs msg 0 dispatch-gap-note-max-length))))

(defn dropped-parcel-draft-lines
  "Note to the coordinator only - same posture as unassigned-active-draft-
   lines/open-slot-nudge-draft-lines. Never names a routing target; which
   stage owns the fix is the coordinator's own judgement."
  [item]
  ["type: note"
   "to: coordinator"
   "priority: 00"
   (str "message: " (dropped-parcel-note-message (:id item)))])

(def dropped-parcel-park-status
  "The one ticket status that states a deliberate park (backlog-schema.md:
   \"park a ticket under a stated condition the coordinator may later
   clear\"). BL-1301 reuses it rather than minting a park-specific field, so
   one concept lives in one place - promotion_gates_lib.bb already refuses to
   auto-promote on the same value."
  "blocked")

(def dropped-parcel-park-suppression-reason
  "Logged verbatim beside the ticket id whenever a park silences a nudge, so
   a suppression is recorded rather than silent (BL-1301 invariant 3)."
  "status: blocked - deliberately parked")

(defn parked-ticket?
  "Pure. True only when the ticket declares exactly `status: blocked`.
   Opt-in and fail-closed (BL-1301 invariant 1): a nil, blank, or any other
   status - including an absent field, and including a differently-cased
   spelling promotion_gates_lib.bb would not honour either - is NOT a park,
   and is nudged exactly as it is today. Absence must never buy silence, the
   same posture Article 3.2.4 gives a defect with no severity."
  [status]
  (= dropped-parcel-park-status (some-> status str/trim)))

(defn decide-dropped-parcel?
  "Pure. has-trail?: some handoff anywhere has ever referenced this id (the
   same dispatch-trail definition BL-222 uses). live-mail?: a parcel for
   this id currently sits in ANY role's new or in_process. newest-trail-ms:
   epoch ms of the freshest trail event EXCLUDING this sweep's own prior
   nudges (nil when no qualifying event exists - see newest-trail-event-ms).
   status: the ticket's own `status:` field, or nil when it declares none.
   Returns true only when the item has a trail, no live mail anywhere, that
   trail has gone stale past stall-threshold-ms, and the ticket is not
   deliberately parked (BL-1301) - never on missing data (a nil
   newest-trail-ms fails closed, not open; so does a nil status)."
  [{:keys [has-trail? live-mail? newest-trail-ms status]} now-ms stall-threshold-ms]
  (boolean
   (and has-trail?
        (not live-mail?)
        (not (parked-ticket? status))
        (number? newest-trail-ms)
        (number? now-ms)
        (number? stall-threshold-ms)
        (>= (- now-ms newest-trail-ms) stall-threshold-ms))))

(defn within-dropped-parcel-cooldown?
  "True when last-sent-ms (the last dropped-parcel nudge sent for THIS
   ticket, if any) is still within cooldown-ms of now-ms. Mirrors within-
   open-slot-cooldown?'s shape, but keyed per ticket by the caller (each
   dropped ticket runs its own independent cooldown clock, unlike open-
   slot's single global timestamp)."
  [last-sent-ms now-ms cooldown-ms]
  (and (number? last-sent-ms)
       (number? now-ms)
       (number? cooldown-ms)
       (<= 0 (- now-ms last-sent-ms) cooldown-ms)))

(def dropped-parcel-stall-default-threshold-ms
  "Well above normal inter-stage latency so an ordinary gap between
   pipeline stages is never mistaken for a drop (the ticket's own
   requirement). Amendable via swarmforge.conf."
  (* 45 60 1000))

(defn parse-dropped-parcel-stall-threshold-ms
  "Pure: `config dropped_parcel_stall_threshold_minutes <n>` from conf
   text, in minutes, converted to ms. A non-positive or unparseable value
   degrades to the default (mirrors parse-open-slot-escalation-threshold's
   own degrade-to-default posture)."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config dropped_parcel_stall_threshold_minutes"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) (* n 60 1000) dropped-parcel-stall-default-threshold-ms)))

(def dropped-parcel-cooldown-default-ms
  "Default cooldown between repeated nudges for the SAME still-dropped
   ticket (invariant 3): one nudge per window, not every tick."
  (* 30 60 1000))

(defn parse-dropped-parcel-cooldown-ms
  "Pure: `config dropped_parcel_cooldown_minutes <n>` from conf text, in
   minutes, converted to ms. Same degrade-to-default posture as the stall
   threshold parser above."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config dropped_parcel_cooldown_minutes"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) (* n 60 1000) dropped-parcel-cooldown-default-ms)))

(defn- dropped-parcel-self-nudge?
  "True when file-path's own message header is this sweep's own nudge
   text - excluded from trail-freshness so a self-sent nudge never re-arms
   the stale-trail check (BL-719 invariant 3)."
  [file-path]
  (let [msg (read-header-field file-path "message")]
    (boolean (and msg (str/includes? msg dropped-parcel-nudge-phrase)))))

(defn- parse-instant-ms
  "Pure: an ISO-8601 instant string to epoch millis, or nil when absent,
   blank, or unparseable - never throws. Mirrors mono_router_lib.bb's own
   parse-instant-ms exactly (small pure helper, deliberately duplicated
   across independent libs per this file's own established posture, see
   the BL-488-VIOLATION comment above)."
  [s]
  (try
    (some-> s str str/trim not-empty java.time.Instant/parse .toEpochMilli)
    (catch Exception _ nil)))

(defn- handoff-event-ms
  "A handoff file's own age-source timestamp: enqueued_at if parseable,
   else created_at - never file mtime (a worktree hot-sync or archive move
   can touch mtime without a new event happening; mirrors mono_router_lib.
   bb's note-aged? precedence exactly)."
  [file-path]
  (or (parse-instant-ms (read-header-field file-path "enqueued_at"))
      (parse-instant-ms (read-header-field file-path "created_at"))))

(defn newest-trail-event-ms
  "The freshest trail-event timestamp (epoch ms) for item-id across
   scan-dirs, from each matching handoff's own enqueued_at/created_at
   header. BL-1223: matches via dispatch-trail-ticket-id, the SAME narrowed
   dispatch predicate collect-dispatched-ticket-ids uses (this function's
   own definition must stay byte-identical to build-dropped-parcel-trail-
   index's single-pass :trail derivation, BL-978 invariant 2 - narrowing
   one without the other would reintroduce exactly the drift-between-two-
   copies defect BL-978 exists to prevent). Excludes this sweep's OWN prior
   nudges (BL-719 invariant 3) so a still-dropped ticket stays detectably
   stale across repeated nudge cycles, and skips any file with no
   parseable timestamp header at all (never a false freshness signal from
   missing data). Returns nil when no qualifying trail file exists."
  [item-id scan-dirs]
  (->> scan-dirs
       (mapcat list-handoff-files-with-batches)
       (filter #(= item-id (dispatch-trail-ticket-id (dispatch-trail-headers %))))
       (remove dropped-parcel-self-nudge?)
       (keep handoff-event-ms)
       (reduce (fn [best ms] (if (or (nil? best) (> ms best)) ms best)) nil)))

;; ── BL-978: single-pass trail index ────────────────────────────────────────
;; dropped-parcel-items used to call newest-trail-event-ms once PER active
;; item, and every call re-listed and re-slurped every handoff file in all
;; 40 scan dirs (~5900 files x 8 items = ~47000 reads; sweep boundaries
;; measured 30-143269 ms on 2026-08-20, blocking mail delivery for the
;; whole window and opening BL-977's false-halt window). The sweep now
;; walks the scan dirs ONCE, reading each handoff file exactly once and
;; deriving every per-ticket fact (has-trail, live mail, newest qualifying
;; trail event) from that single read. The decision definitions - trail,
;; live mail, BL-719's self-nudge exclusion, the unparseable-timestamp
;; skip, and decide-dropped-parcel? itself - are byte-identical (invariant
;; 2); this is a data-access change only.

(defn- handoff-headers
  "One read, one parse: every `field: value` line of file-path's header
   block (before the first blank line) as a map. Field/value splitting
   matches read-header-field's own `<field>: ` convention exactly."
  [file-path]
  (let [header (first (str/split (*read-handoff-file* file-path) #"\n\n" 2))]
    (into {}
          (keep (fn [line]
                  (when-let [idx (str/index-of line ": ")]
                    [(subs line 0 idx) (subs line (+ idx 2))])))
          (str/split-lines header))))

(defn build-dropped-parcel-trail-index
  "BL-978 invariant 1: ONE pass over the union of all-scan-dirs and
   live-mail-dirs, reading each handoff file exactly once, producing
   {:trail {ticket-id {:newest-trail-ms ms-or-nil}} :live-ids #{ticket-id}}.
   Trail evidence comes from files under all-scan-dirs (has-trail
   membership = dispatch-trail-ticket-id, exactly as
   collect-dispatched-ticket-ids counts a dispatch - BL-1223: a handoff
   that merely MENTIONS the ticket, self-nudges included, no longer
   qualifies; newest-trail-ms = the freshest enqueued_at/created_at among
   those same trail-qualifying files, EXCLUDING this sweep's own prior
   nudges per BL-719 invariant 3, files with no parseable timestamp
   skipped, nil when nothing qualifies - exactly newest-trail-event-ms's
   definition). live-ids come from files under live-mail-dirs, keeping the
   BROAD 'does this handoff mention this ticket' question unchanged
   (BL-1223 invariant 3 - live-mail? is correctly broad, only :trail
   narrows). A dir in both sets contributes to both from the same single
   read; adding an active ticket adds no filesystem work at all."
  [all-scan-dirs live-mail-dirs]
  (let [trail-set (set (map str all-scan-dirs))
        live-set (set (map str live-mail-dirs))]
    (reduce
     (fn [acc dir]
       (let [trail? (contains? trail-set dir)
             live? (contains? live-set dir)]
         (reduce
          (fn [acc file]
            (let [headers (handoff-headers file)
                  task (get headers "task")
                  msg (get headers "message")
                  ;; BL-1223: :live-ids keeps the BROAD "does this handoff
                  ;; mention this ticket" question unchanged (invariant 3 -
                  ;; live-mail? is correctly broad); :trail narrows to
                  ;; dispatch-trail-ticket-id, the SAME predicate
                  ;; collect-dispatched-ticket-ids/newest-trail-event-ms use.
                  live-id (extract-ticket-id (or task msg))
                  trail-id (dispatch-trail-ticket-id {:task task :message msg})
                  acc (if (and live? live-id) (update acc :live-ids conj live-id) acc)]
              (if-not (and trail? trail-id)
                acc
                (let [self-nudge? (boolean (and msg (str/includes? msg dropped-parcel-nudge-phrase)))
                      event-ms (or (parse-instant-ms (get headers "enqueued_at"))
                                   (parse-instant-ms (get headers "created_at")))
                      acc (update-in acc [:trail trail-id] #(or % {:newest-trail-ms nil}))]
                  (if (and (not self-nudge?) event-ms)
                    (update-in acc [:trail trail-id :newest-trail-ms]
                               (fn [best] (if (or (nil? best) (> event-ms best)) event-ms best)))
                    acc)))))
          acc
          (list-handoff-files-with-batches dir))))
     {:trail {} :live-ids #{}}
     (distinct (map str (concat all-scan-dirs live-mail-dirs))))))

(defn dropped-parcel-evaluation
  "One evaluation tick, in the shape the caller needs to both nudge AND
   record: {:items [nudge candidates] :suppressed [parked tickets a nudge
   would otherwise have named]}. Arguments are dropped-parcel-items' own
   (see its docstring). :suppressed holds exactly the items that ARE dropped
   by every other measure but declare a deliberate park - never a parked
   ticket the sweep would have passed over anyway - so the caller's log line
   names only what the park actually silenced (BL-1301 invariant 3). One
   trail index pass serves both keys, so BL-978's single-read guarantee is
   unchanged."
  [active-dir all-scan-dirs live-mail-dirs now-ms stall-threshold-ms]
  (let [items (read-active-items active-dir)
        {:keys [trail live-ids]} (build-dropped-parcel-trail-index all-scan-dirs live-mail-dirs)
        facts (fn [item]
                {:has-trail? (contains? trail (:id item))
                 :live-mail? (contains? live-ids (:id item))
                 :newest-trail-ms (get-in trail [(:id item) :newest-trail-ms])
                 :status (:status item)})]
    {:items (filterv #(decide-dropped-parcel? (facts %) now-ms stall-threshold-ms) items)
     :suppressed (filterv #(and (parked-ticket? (:status %))
                                (decide-dropped-parcel? (dissoc (facts %) :status)
                                                        now-ms stall-threshold-ms))
                          items)}))

(defn dropped-parcel-items
  "Full pipeline for one evaluation tick. active-dir: backlog/active/.
   all-scan-dirs: every role's :new/:in_process/:completed/:sent/:outbox
   (same set BL-222's dispatch-gap-scan-dirs builds - used for has-trail?
   and newest-trail-ms). live-mail-dirs: every role's :new/:in_process
   ONLY (used for live-mail?). Returns the active items with a trail, no
   live mail anywhere, and a trail gone stale past stall-threshold-ms - the
   dropped-parcel candidates for a coordinator nudge, minus any ticket
   declaring a deliberate park (BL-1301 - dropped-parcel-evaluation returns
   those separately, as :suppressed, so the caller can log them).
   BL-978: the evidence
   comes from build-dropped-parcel-trail-index's single pass; the decision
   (decide-dropped-parcel?) and every definition it consumes are unchanged
   (invariant 2 - the candidate set is the contract)."
  [active-dir all-scan-dirs live-mail-dirs now-ms stall-threshold-ms]
  (:items (dropped-parcel-evaluation active-dir all-scan-dirs live-mail-dirs
                                     now-ms stall-threshold-ms)))

;; ── BL-678: batch-claim-progress sidecar (live-owner half of BL-648's ──────
;; source near-miss) ─────────────────────────────────────────────────────────
;; Chase-side observer for batch-mode claims: reads/refreshes each batch
;; item's .batch-claim-progress.json sidecar (written at claim time by
;; ready_for_next_batch.bb) from the owning role's worktree HEAD, and
;; surfaces - never re-forwards, never re-delivers, never bounces/halts - a
;; named suspect note to the coordinator when progress has gone stale.
;; Deliberately does not touch BL-528's .claim-progress.json escalation
;; ladder above; scoped by the caller (handoffd.bb) to :receive-mode "batch"
;; roles only.

(defn read-batch-claim-progress [in-process-file-path]
  (let [data (read-json (batch-claim-progress-lib/sidecar-path in-process-file-path))]
    (when (and (map? data) (number? (:claimAtMs data)) (number? (:lastProgressAtMs data)))
      data)))

(defn write-batch-claim-progress! [in-process-file-path progress]
  (spit (batch-claim-progress-lib/sidecar-path in-process-file-path)
        (json/generate-string progress)))

(def batch-claim-progress-stale-default-threshold-ms
  batch-claim-progress-lib/default-stale-threshold-ms)

(defn parse-batch-claim-progress-stale-threshold-ms
  "Pure: `config batch_claim_progress_stale_threshold_minutes <n>` from conf
   text, in minutes, converted to ms. Same degrade-to-default posture as the
   dropped-parcel stall-threshold parser above."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config batch_claim_progress_stale_threshold_minutes"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) (* n 60 1000) batch-claim-progress-stale-default-threshold-ms)))

(defn parse-batch-claim-progress-role-stale-threshold-ms
  "BL-1076. Pure: every
   `config batch_claim_progress_role_stale_threshold_minutes <role> <n>` line
   from conf text, as a {role ms} map. Same degrade-to-default posture as the
   two parsers beside it, applied per line: a line whose minutes are missing,
   unparseable or non-positive is simply DROPPED from the map, so the role
   falls back to its built-in tolerance rather than to something tighter.
   A repeated role takes the last line, matching how the single-value parsers
   above would behave if they scanned rather than took `first`."
  [conf-text]
  (reduce
   (fn [acc line]
     (let [[_ role mins] (re-matches
                          #"config\s+batch_claim_progress_role_stale_threshold_minutes\s+(\S+)\s+(-?\d+)\s*"
                          line)
           n (some-> mins parse-long)]
       (if (and role n (pos? n))
         (assoc acc role (* n 60 1000))
         acc)))
   {}
   (str/split-lines (or conf-text ""))))

(def batch-claim-progress-cooldown-default-ms
  "Default cooldown between repeated suspect nudges for the SAME still-stale
   batch item: one nudge per window, not every sweep tick."
  (* 30 60 1000))

(defn parse-batch-claim-progress-cooldown-ms
  "Pure: `config batch_claim_progress_cooldown_minutes <n>` from conf text,
   in minutes, converted to ms."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config batch_claim_progress_cooldown_minutes"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) (* n 60 1000) batch-claim-progress-cooldown-default-ms)))

(defn batch-claim-progress-suspect-note-message
  [item-id age-ms]
  (let [msg (str item-id " batch claim stale " (quot age-ms 60000) "m since progress, not re-delivered.")]
    (if (<= (count msg) dispatch-gap-note-max-length)
      msg
      (subs msg 0 dispatch-gap-note-max-length))))

(defn batch-claim-progress-suspect-draft-lines
  "Note to the coordinator only - same posture as dropped-parcel-draft-lines
   above. Never routes, assigns, or promotes; never re-forwards or re-
   delivers the parcel itself (invariant 2)."
  [item-id age-ms]
  ["type: note"
   "to: coordinator"
   "priority: 00"
   (str "message: " (batch-claim-progress-suspect-note-message item-id age-ms))])

(defn apply-batch-claim-progress-check!
  "Refreshes (impure) each held batch item's sidecar from current-commit,
   then classifies it via the pure decide-batch-claim-observation.

   BL-1076: returns {:suspects [...] :suppressed [...]} rather than a bare
   seq. Both entries carry {:file-path :item-id :age-ms}; :suppressed adds
   :reason. The caller (handoffd.bb) sends a note for each suspect, respecting
   its own per-item cooldown, and LOGS each suppression - a suppression that
   went unrecorded would let a permanently dirty worktree silence the signal
   with nothing to show for it (invariant 2).

   staleness-threshold-ms is already resolved FOR THIS ROLE by the caller (see
   batch-claim-progress-lib/resolve-stale-threshold-ms) - this function is
   role-agnostic and simply applies the number it is given.

   The sidecar's progress instant still moves ONLY when HEAD actually advances
   (invariant 3): neither gate defers a decision by rewriting it, so a reported
   age is always the true age since real progress.

   Never moves, deletes, or otherwise touches the handoff file itself - the
   only side effect here is the sidecar write."
  [held now-ms staleness-threshold-ms current-commit worktree-dirty?]
  (reduce
   (fn [acc item]
     (let [fp (:filePath item)
           progress (read-batch-claim-progress fp)]
       (if-not progress
         acc
         (let [progress' (if (batch-claim-progress-lib/advanced? progress current-commit)
                           (batch-claim-progress-lib/mark-progress progress current-commit now-ms)
                           progress)
               _ (write-batch-claim-progress! fp progress')
               observation (batch-claim-progress-lib/decide-batch-claim-observation
                            progress' now-ms staleness-threshold-ms worktree-dirty?)
               entry {:file-path fp
                      :item-id (or (extract-ticket-id (dispatch-ticket-ref fp)) (handoff-id fp))
                      :age-ms (batch-claim-progress-lib/progress-age-ms progress' now-ms)}]
           (case observation
             :stale-suspect (update acc :suspects conj entry)
             :suppressed-visible-work (update acc :suppressed conj
                                              (assoc entry :reason "worktree-dirty"))
             acc)))))
   {:suspects [] :suppressed []}
   held))

;; ── BL-1104: landed-but-open QA re-notify (sibling of BL-222 / unassigned) ─
;; An active ticket whose QA approval is already on origin/main (or main)
;; but that was never closed holds a depth-cap slot forever. dispatch-gap
;; and unassigned-active both key on an ABSENT trail, so a ticket that
;; walked the whole pipeline looks healthy to both. This third sibling asks
;; the opposite question against subject-anchored git history only — never
;; `git log --grep` (body match = trap (a) / scenario 04) and never
;; backlog/evidence/*-qa-pass-*.md (trap (b)). Observe + nudge QA only.

(def landed-but-open-nudge-phrase "landed-but-open")

(def ticket-id-anywhere-pattern
  "Same allowlist as leading-ticket-id-pattern / pipeline_stage_lib, but
   matches anywhere in a subject line (QA-approved subjects rarely lead
   with the id)."
  (re-pattern (str "(?i)\\b(" (str/join "|" known-ticket-prefixes) ")-?(\\d+)\\b")))

(defn ticket-ids-in-text
  "Every ticket id named in text, upper-case, de-duplicated, first-seen
   order. nil when none — mirrors pipeline_stage_lib/extract-ticket-ids."
  [text]
  (when text
    (seq (into [] (comp (map (fn [[_ prefix digits]]
                               (str/upper-case (str prefix "-" digits))))
                        (distinct))
               (re-seq ticket-id-anywhere-pattern text)))))

(defn short-sha-10
  "Swarm handoff convention: exactly 10 hex when the input is long enough."
  [sha]
  (when sha
    (subs sha 0 (min 10 (count sha)))))

(defn qa-approval-signal?
  "Subject-level QA approval cue (not body). Live shapes: 'QA-approved
   BL-####' landing/merge-up subjects and 'BL-####: QA pass inventory…'."
  [subject]
  (boolean (re-find #"(?i)QA[- ]approved|QA pass inventory" (or subject ""))))

(defn- subject-names-ticket?
  [subject ticket-id]
  (boolean (some #(= ticket-id %) (ticket-ids-in-text subject))))

(defn qa-approval-subject?
  "True when subject names ticket-id AND carries a QA approval signal."
  [subject ticket-id]
  (and (qa-approval-signal? subject)
       (subject-names-ticket? subject ticket-id)))

(defn close-subject?
  "True when subject is a Close of ticket-id (subject only)."
  [subject ticket-id]
  (and (boolean (re-find #"(?i)\bClose\b" (or subject "")))
       (subject-names-ticket? subject ticket-id)))

(defn index-qa-approvals
  "commits: seq of {:sha :subject}, newest-first (git log order). First
   matching approval per ticket wins. Never inspects commit bodies."
  [commits]
  (reduce
   (fn [acc {:keys [sha subject]}]
     (reduce
      (fn [a id]
        (if (or (contains? a id) (not (qa-approval-subject? subject id)))
          a
          (assoc a id (short-sha-10 sha))))
      acc
      (or (ticket-ids-in-text subject) [])))
   {}
   commits))

(defn index-closed-tickets
  "Set of ticket ids with a Close subject on the scanned ref."
  [commits]
  (reduce
   (fn [acc {:keys [subject]}]
     (into acc
           (filter #(close-subject? subject %)
                   (or (ticket-ids-in-text subject) []))))
   #{}
   commits))

(defn decide-landed-but-open
  "Pure core. active-ids: collection of active ticket ids. approvals: map
   id -> short-sha. closed-ids / nudged-ids: sets. Returns
   [{:id :approval-commit} ...] for tickets that need a QA re-notify."
  [active-ids approvals closed-ids nudged-ids]
  (->> active-ids
       (keep (fn [id]
               (when-let [sha (get approvals id)]
                 (when (and (not (contains? closed-ids id))
                            (not (contains? nudged-ids id)))
                   {:id id :approval-commit sha}))))
       vec))

(defn landed-but-open-note-message
  [item]
  (let [msg (str (:id item) " " landed-but-open-nudge-phrase " "
                 (:approval-commit item) " - resend coordinator notify")]
    (if (<= (count msg) dispatch-gap-note-max-length)
      msg
      (subs msg 0 dispatch-gap-note-max-length))))

(defn landed-but-open-draft-lines
  "Note to QA only — never closes, moves, or sends the coordinator notify."
  [item]
  ["type: note"
   "to: QA"
   "priority: 00"
   (str "message: " (landed-but-open-note-message item))])

(defn read-active-ticket-ids
  "Every backlog/active/*.yaml id (assigned or not). Missing id skipped."
  [active-dir]
  (if-not (fs/exists? active-dir)
    #{}
    (->> (fs/list-dir active-dir)
         (filter #(str/ends-with? (fs/file-name %) ".yaml"))
         (map read-active-item)
         (keep :id)
         set)))

(defn collect-landed-but-open-nudged-ids
  "Ticket ids that already have a landed-but-open nudge on record in any
   scanned mailbox (the nudge itself is the idempotence trail)."
  [dirs]
  (->> dirs
       (mapcat list-handoff-files-with-batches)
       (keep (fn [fp]
               (let [msg (read-header-field fp "message")]
                 (when (and msg (str/includes? msg landed-but-open-nudge-phrase))
                   (extract-ticket-id msg)))))
       set))

(defn resolve-landed-main-ref
  "Prefer origin/main (durable remote tip); fall back to main."
  [repo-root]
  (let [r (daemon-cycle-guard-lib/sh!
           ["git" "-C" (str repo-root) "rev-parse" "--verify" "origin/main"])]
    (if (zero? (:exit r)) "origin/main" "main")))

(defn read-ref-subject-commits
  "Subject-only history for git-ref. Never returns body text — trap (a)."
  [repo-root git-ref]
  (let [r (daemon-cycle-guard-lib/sh!
           ["git" "-C" (str repo-root) "log" "--format=%H%x00%s" git-ref])]
    (if-not (zero? (:exit r))
      []
      (->> (str/split-lines (or (:out r) ""))
           (remove str/blank?)
           (keep (fn [line]
                   (let [[sha subject] (str/split line #"\x00" 2)]
                     (when (and (not (str/blank? sha)) (some? subject))
                       {:sha sha :subject subject}))))
           vec))))

(defn landed-but-open-items
  "Full pipeline: active ids × subject-anchored approvals/closes × nudge trail."
  [active-dir commits scan-dirs]
  (decide-landed-but-open
   (read-active-ticket-ids active-dir)
   (index-qa-approvals commits)
   (index-closed-tickets commits)
   (collect-landed-but-open-nudged-ids scan-dirs)))

(defn landed-but-open-boundary-detail
  "One diagnosable detail string for the per-cycle landed-but-open log line."
  [items]
  (if (empty? items)
    "none"
    (str/join "," (map #(str (:id %) "=" (:approval-commit %)) items))))

;; ── BL-568: AskUserQuestion / menu-blocked pane detection ───────────────────
;; Pure: classify a pane capture as menu-blocked and extract question/options
;; for Telegram poll surfacing. Never auto-answers; transport only.

(def ^:private bl568-menu-footer-re
  #"(?i)Enter to select.*(?:Tab|Arrow).*Esc to cancel")

(def ^:private bl568-nav-hint-re
  #"(?i)Tab/Arrow keys to navigate")

(def ^:private bl568-footer-noise-re
  #"(?i)Tab/Arrow|Esc to cancel")

(def ^:private bl568-option-line-re
  #"(?m)^[❯>]?\s*(\d+)[.)]\s+(.+)$")

(def ^:private bl568-checkbox-option-re
  #"(?m)^[❯>]?\s*\[[ xX]\]\s+(.+)$")

(def ^:private bl568-choice-marker-re
  #"(?m)^[❯>]\s+\S")

(defn- bl568-menu-chrome?
  [pane-text]
  (boolean (or (re-find bl568-menu-footer-re pane-text)
               (re-find bl568-nav-hint-re pane-text))))

(defn- bl568-has-option-chrome?
  [pane-text]
  (boolean (or (re-find bl568-option-line-re pane-text)
               (re-find bl568-checkbox-option-re pane-text)
               (re-find bl568-choice-marker-re pane-text))))

(defn bl568-detect-menu-blocked
  "True when pane text shows a Claude Code interactive menu footer (or
   equivalent AskUserQuestion chrome) with at least one numbered/checkbox
   option. Menu-blocked is BLOCKED, not idle."
  [pane-text]
  (let [t (str pane-text)]
    (boolean (and (bl568-menu-chrome? t) (bl568-has-option-chrome? t)))))

;; camelCase alias required by ticket required_wiring
(def bl568DetectMenuBlocked bl568-detect-menu-blocked)

(defn- bl568-parse-option-line
  [line]
  (let [trimmed (str/trim (str line))]
    (or (when-let [[_ n rest] (re-matches bl568-option-line-re trimmed)]
          {:index (Long/parseLong n) :text (str/trim rest) :kind :numbered})
        (when-let [[_ text] (re-matches bl568-checkbox-option-re trimmed)]
          {:index nil :text (str/trim text) :kind :checkbox})
        (when (re-matches #"^[❯>]\s+.+" trimmed)
          {:index nil :text (str/replace trimmed #"^[❯>]\s+" "") :kind :choice}))))

(defn- bl568-free-text-option?
  [text]
  (boolean (re-find #"(?i)^(type something|other|something else|write your own)" (str text))))

(defn- bl568-question-candidate-line?
  [line]
  (not (or (re-find bl568-menu-footer-re line)
           (re-find bl568-footer-noise-re line)
           (bl568-parse-option-line line))))

(defn bl568-menu-fingerprint
  "Stable fingerprint of question + ordered option texts (surface-time)."
  [question options]
  (str (hash (pr-str [(str question) (mapv str options)]))))

(defn bl568-extract-menu
  "Pure extract: {:question :options :multi-select? :free-text-indexes :fingerprint
   :blocked?} from a pane capture. Options are display strings in menu order."
  [pane-text]
  (let [t (str pane-text)
        blocked? (bl568-detect-menu-blocked t)
        lines (->> (str/split-lines t) (map str/trim) (remove str/blank?))
        opts (vec (keep bl568-parse-option-line lines))
        option-texts (mapv :text opts)
        ;; Question: last non-option, non-footer line above the first option.
        question (->> lines (filter bl568-question-candidate-line?) last str)
        free-idxs (vec (keep-indexed (fn [i o] (when (bl568-free-text-option? o) i)) option-texts))
        multi? (boolean (some #(= :checkbox (:kind %)) opts))]
    {:blocked? blocked?
     :question (if (str/blank? question) "(menu)" question)
     :options option-texts
     :multi-select? multi?
     :free-text-indexes free-idxs
     :fingerprint (bl568-menu-fingerprint question option-texts)}))

(def ^:private bl568-tg-question-max 300)
(def ^:private bl568-tg-option-max 100)
(def ^:private bl568-tg-options-max 10)

(defn bl568-truncate-ellipsis
  [s limit]
  (let [t (str s)]
    (if (<= (count t) limit)
      t
      (str (subs t 0 (max 0 (dec limit))) "…"))))

(defn bl568-poll-surface-plan
  "Decide poll vs text fallback for Telegram caps. Returns
   {:mode :poll :question :options :allows-multiple} or
   {:mode :text-fallback :reason :question}."
  [extracted]
  (let [opts (vec (:options extracted))
        q (bl568-truncate-ellipsis (:question extracted) bl568-tg-question-max)
        truncated-opts (mapv #(bl568-truncate-ellipsis % bl568-tg-option-max) opts)]
    (cond
      (not (:blocked? extracted))
      {:mode :skip :reason "not-menu-blocked"}

      (empty? opts)
      {:mode :text-fallback :reason "no-options" :question q}

      (> (count opts) bl568-tg-options-max)
      {:mode :text-fallback :reason "too-many-options" :question q :option-count (count opts)}

      (some #(<= (count (str %)) 0) truncated-opts)
      {:mode :text-fallback :reason "empty-option-after-truncate" :question q}

      :else
      {:mode :poll
       :question q
       :options truncated-opts
       :allows-multiple (boolean (:multi-select? extracted))
       :fingerprint (:fingerprint extracted)
       :free-text-indexes (:free-text-indexes extracted)})))

;; ── BL-1171: structured BABYSITTER_ESCALATION detail ───────────────────────

(defn format-babysitter-escalation-detail
  "When finding carries :disaster-class, detail is JSON the operator prompt
   can parse (failure_class, suggested_actions, evidence_paths). Otherwise
   the plain symptom message (BL-653)."
  [{:keys [message disaster-class]}]
  (if disaster-class
    (json/generate-string (assoc disaster-class :summary (or message "")))
    (or message "")))

(defn parse-babysitter-escalation-detail
  "Pure: parse operator-queue detail back to a map when JSON; else nil."
  [detail]
  (try
    (let [parsed (json/parse-string (str detail) true)]
      (when (map? parsed) parsed))
    (catch Exception _ nil)))
