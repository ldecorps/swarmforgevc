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

;; BL-528: claim-without-progress detection.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "claim_progress_lib.bb")))

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
(defn decide-item-action
  [item-mtime-ms chase-count now-ms config liveness last-activity-ms last-chased-at-ms already-terminal?]
  (if already-terminal?
    "reaped"
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

;; ── impure sweep application (adapters map, mirrors ChaserAdapters) ─────────
;; adapters keys: :get-liveness :send-wake-up! :trigger-respawn! :log-dead-letter!
;;                :get-last-activity-ms :on-stuck-escalation! :log-telemetry!
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

(defn- apply-stuck-nudge! [role held adapters now-ms]
  ;; Prefer an in-process resume wake when the adapter provides one — re-running
  ;; ready_for_next on aider just reprints the same TASK and loops.
  (if-let [resume! (:send-in-process-resume! adapters)]
    (resume! role)
    ((:send-wake-up! adapters) role))
  (doseq [item held]
    (let [count (inc (:nudgeCount item))]
      (write-nudge-count! (:filePath item) count)
      ((:log-telemetry! adapters) {:type "nudge" :role role :handoffId (handoff-id (:filePath item)) :count count} now-ms)))
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
                (do (if-let [resume! (:send-in-process-resume! adapters)]
                      (resume! role)
                      ((:send-wake-up! adapters) role))
                    (write-nudge-count! fp (inc (:nudgeCount item))))

                :bounce
                ((:on-claim-idle-bounce! adapters) role fp p')

                :halt
                (if (claim-progress-lib/should-refuse-claim-halt? ctx)
                  ((:log-telemetry! adapters)
                   {:type "claim-idle-halt-refused" :role role :handoffId (handoff-id fp)
                    :reason "resident-active-or-dormant-stale"}
                   now-ms)
                  (do ((:on-claim-idle-halt! adapters) role fp p')
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
          "alert" ((:on-stuck-escalation! adapters) role true)
          (do (clear-stale-nudge-counts! held)
              ((:on-stuck-escalation! adapters) role false)
              ;; BL-528: even when pane-activity looks healthy, check whether
              ;; the role's worktree HEAD has advanced since the claim.
              (apply-claim-progress-check! role held now-ms config adapters)))))))

(defn- apply-inbox-item-action! [role item action adapters now-ms]
  (case action
    "chased" (let [count (inc (:chaseCount item))]
               ((:send-wake-up! adapters) role)
               (write-chase-count! (:filePath item) count now-ms)
               ((:log-telemetry! adapters) {:type "chase" :role role :handoffId (handoff-id (:filePath item)) :count count} now-ms))
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

(defn reap-orphaned-sidecars! [inbox-new-dir]
  (when (fs/exists? inbox-new-dir)
    (let [filenames (map fs/file-name (fs/list-dir inbox-new-dir))]
      (doseq [orphan (orphaned-sidecar-filenames filenames)]
        (fs/delete (fs/path inbox-new-dir orphan))))))

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
        respawn-cooldown-until-ms (read-respawn-cooldown-until-ms inbox-new-dir)]
    (doseq [item items]
      (let [already-terminal? (handoff-lib/already-terminal?
                                (fs/file-name (:filePath item)) completed-basenames abandoned-basenames)
            decided (decide-item-action (:mtimeMs item) (:chaseCount item) now-ms config
                                         liveness last-activity-ms (:lastChasedAtMs item) already-terminal?)
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
  ((:send-wake-up! adapters) role)
  ((:mark-rate-limit-cooldown-woken! adapters) role cooldown-until-ms))

(defn- sweep-role! [role inbox-new-dir in-process-dir completed-dir abandoned-dir now-ms config adapters]
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

;; ── busy-vs-wedged respawn precheck (BL-137/BL-147 parity) ──────────────────
;; The daemon's own respawn action must never regress the exact incident
;; that motivated BL-147: typing into a pane that is genuinely mid-turn.
;; Primary signal: "esc to interrupt" (Claude Code's busy footer). Subagent
;; explore turns and long Whirlpooling runs often omit that footer while still
;; mid-turn — match those high-confidence activity markers too.

(def busy-activity-patterns
  [#"(?i)esc to interrupt"
   ;; Claude Code status spinners (e.g. "· Whirlpooling… (6m · ↓ 14k tokens)")
   #"(?i)(?:whirlpooling|vibing|perambulating|swirling|marinating|incubating|pondering|noodling|dilly-dallying)[…\.]"
   ;; Long context compaction (omits "esc to interrupt" but is still mid-turn)
   #"(?i)compacting conversation"
   ;; Active explore/bash subagent chrome in the footer or body
   #"[◯●]\s+Explore"
   #"(?i)Explore\("
   ;; Subagent shell commands in flight (line ends with Running…)
   #"(?m)^\s*Running…\s*$"])

(defn actively-processing? [pane-text]
  (let [t (or pane-text "")]
    (boolean (some #(re-find % t) busy-activity-patterns))))

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

(defn- read-header-field [file-path field]
  (let [header (first (str/split (slurp file-path) #"\n\n" 2))
        prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (subs line (count prefix))))
          (str/split-lines header))))

(defn- dispatch-ticket-ref
  "A handoff file's own ticket reference for dispatch-gap purposes: its
   task header (git_handoff) if present, else its message header (note) -
   both conventionally lead with the ticket id."
  [file-path]
  (or (read-header-field file-path "task") (read-header-field file-path "message")))

(defn collect-dispatched-ticket-ids
  "Scans every given directory path for .handoff files (including one level
   of batch_* subdirectories) and returns the set of ticket ids referenced
   in their task/message headers."
  [dirs]
  (->> dirs
       (mapcat list-handoff-files-with-batches)
       (keep dispatch-ticket-ref)
       (keep extract-ticket-id)
       set))

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn- read-active-item [yaml-file]
  (let [content (slurp (str yaml-file))]
    {:id (read-yaml-field content "id")
     :assigned-to (read-yaml-field content "assigned_to")}))

(defn read-active-items
  "Every backlog/active/*.yaml item with both an id and an assigned_to -
   items missing either are not dispatch-gap candidates (nothing to route,
   or nowhere to route it)."
  [active-dir]
  (if-not (fs/exists? active-dir)
    []
    (->> (fs/list-dir active-dir)
         (filter #(str/ends-with? (fs/file-name %) ".yaml"))
         (map read-active-item)
         (filter #(and (:id %) (:assigned-to %)))
         vec)))

(defn dispatch-gap-items
  "Full pipeline for one evaluation: reads active items from active-dir and
   the dispatched-ticket-id set from scan-dirs, returning exactly the items
   needing auto-route. decide-dispatch-gaps above remains the independently
   pure/testable core."
  [active-dir scan-dirs]
  (decide-dispatch-gaps (read-active-items active-dir) (collect-dispatched-ticket-ids scan-dirs)))

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
   dispatch trail still lands rather than silently dropping."
  ([item] (dispatch-gap-draft-lines item nil))
  ([item commit]
   (if (str/blank? commit)
     ["type: note"
      (str "to: " (:assigned-to item))
      "priority: 00"
      (str "message: " (dispatch-gap-note-message (:id item)))]
     ["type: git_handoff"
      (str "to: " (:assigned-to item))
      "priority: 00"
      (str "task: " (:id item))
      (str "commit: " commit)])))

;; ── Unassigned-active coordinator nudge ─────────────────────────────────────
;; Sibling of BL-222 dispatch-gap: an active/*.yaml with an id but NO
;; assigned_to is invisible to read-active-items / auto-route (those require
;; an assignee). Without a nudge, the ticket sits at board NS forever while
;; the coordinator idles on mailbox NO_TASK (it must not self-poll). The
;; durable close is: the daemon notices unassigned actives with no handoff
;; trail yet and drops a note on the COORDINATOR so *it* assigns + routes —
;; never inventing assigned_to here (constitution: intake/routing is the
;; coordinator's exclusive duty).

(defn- blank-assigned? [assigned-to]
  (or (nil? assigned-to) (str/blank? assigned-to)))

(defn read-unassigned-active-items
  "Every backlog/active/*.yaml with an id and a missing/blank assigned_to.
   These need a coordinator nudge, not an assignee auto-route."
  [active-dir]
  (if-not (fs/exists? active-dir)
    []
    (->> (fs/list-dir active-dir)
         (filter #(str/ends-with? (fs/file-name %) ".yaml"))
         (map read-active-item)
         (filter #(and (:id %) (blank-assigned? (:assigned-to %))))
         vec)))

(defn unassigned-active-items
  "Unassigned actives that still have no handoff trail anywhere — same
   decide-dispatch-gaps core as BL-222, different input set."
  [active-dir scan-dirs]
  (decide-dispatch-gaps (read-unassigned-active-items active-dir)
                        (collect-dispatched-ticket-ids scan-dirs)))

(defn unassigned-active-note-message
  "Leads with the ticket id so the next sweep treats the nudge itself as a
   trail (no spam). Coordinator must then assign_to + route; we never set
   assigned_to from this sweep."
  [item-id]
  (let [msg (str item-id " active unassigned - assign_to and route it.")]
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

(defn open-slot-nudge-message
  "Fixed message — kept under the 80-char handoff limit. No ticket id: the
   trail/cooldown is phrase + optional cooldown file, not BL-222's id set."
  []
  open-slot-nudge-phrase)

(defn decide-open-slot-nudge?
  "Pure decision: capacity under cap, at least one eligible paused ticket,
   no pending open-slot note still sitting in coordinator new/in_process,
   and not within the post-send cooldown window."
  [active-count cap paused-eligible-count {:keys [pending-nudge? within-cooldown?]
                                           :or {pending-nudge? false within-cooldown? false}}]
  (and (number? active-count)
       (number? cap)
       (< active-count cap)
       (pos? (long (or paused-eligible-count 0)))
       (not pending-nudge?)
       (not within-cooldown?)))

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
  "Note to the coordinator only — never promotes or routes to coder."
  []
  ["type: note"
   "to: coordinator"
   "priority: 00"
   (str "message: " (open-slot-nudge-message))])
