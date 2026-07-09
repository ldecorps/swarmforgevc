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

(defn decide-item-action
  [item-mtime-ms chase-count now-ms config liveness last-activity-ms last-chased-at-ms]
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
          (decide-stale-item-action chase-count config liveness))))))

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
    (if (or (nil? previous) (not= (:hash previous) hash))
      (do (swap! activity-records assoc role {:hash hash :lastChangeMs now-ms})
          now-ms)
      (max (:lastChangeMs previous) outbox-activity-ms))))

(defn reset-pane-activity! []
  (reset! activity-records {}))

;; ── impure sweep application (adapters map, mirrors ChaserAdapters) ─────────
;; adapters keys: :get-liveness :send-wake-up! :trigger-respawn! :log-dead-letter!
;;                :get-last-activity-ms :on-stuck-escalation! :log-telemetry!

;; BL-098: durable per-role chase/nudge/dead-letter/respawn counts. The
;; existing sidecars (.chase.json/.nudge) are ephemeral - abandoned once an
;; item completes - so nothing could answer "how many nudges did a role
;; need this week?" Every decision point below appends one event through
;; :log-telemetry! (role, event type, handoff id, count-so-far); the
;; adapter owns the timestamp and the durable file, keeping this file pure.
(defn- handoff-id [file-path]
  (fs/file-name file-path))

(defn- apply-stuck-nudge! [role held adapters now-ms]
  ((:send-wake-up! adapters) role)
  (doseq [item held]
    (let [count (inc (:nudgeCount item))]
      (write-nudge-count! (:filePath item) count)
      ((:log-telemetry! adapters) {:type "nudge" :role role :handoffId (handoff-id (:filePath item)) :count count} now-ms)))
  ((:on-stuck-escalation! adapters) role false))

(defn- clear-stale-nudge-counts! [held]
  (doseq [item held :when (pos? (:nudgeCount item))]
    (write-nudge-count! (:filePath item) 0)))

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
              ((:on-stuck-escalation! adapters) role false)))))))

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
    nil))

(defn sweep-role-inbox! [role inbox-new-dir now-ms config adapters]
  (let [items (scan-inbox-new inbox-new-dir)
        liveness ((:get-liveness adapters) role)
        last-activity-ms ((:get-last-activity-ms adapters) role)
        respawn-cooldown-until-ms (read-respawn-cooldown-until-ms inbox-new-dir)]
    (doseq [item items]
      (let [decided (decide-item-action (:mtimeMs item) (:chaseCount item) now-ms config
                                         liveness last-activity-ms (:lastChasedAtMs item))
            action (if (and (= decided "respawned") (is-cooling-down? respawn-cooldown-until-ms now-ms))
                     "chased"
                     decided)]
        (apply-inbox-item-action! role item action adapters now-ms)
        (when (= action "respawned")
          (write-respawn-cooldown-until-ms! inbox-new-dir (+ now-ms (* (:respawnCooldownSeconds config) 1000))))))))

(defn run-sweep!
  "role-inboxes: seq of {:role :inbox-new-dir :in-process-dir}. Does not own
   dead-letter recovery/escalation (handoffRecovery.ts) or token-exhaustion
   cooldown-wake - both are unwired at the current extension.ts call site
   too, and are deferred to a follow-up ticket rather than widening this
   parcel."
  [role-inboxes now-ms config adapters]
  (doseq [{:keys [role inbox-new-dir in-process-dir]} role-inboxes]
    (sweep-in-process! role in-process-dir now-ms config adapters)
    (sweep-role-inbox! role inbox-new-dir now-ms config adapters)))

;; ── busy-vs-wedged respawn precheck (BL-137/BL-147 parity) ──────────────────
;; The daemon's own respawn action must never regress the exact incident
;; that motivated BL-147: typing into a pane that is genuinely mid-turn.
;; "esc to interrupt" is Claude Code's own busy footer (case-insensitive),
;; the same signal extension/src/panel/agentPaneState.ts checks.

(def busy-footer-pattern #"(?i)esc to interrupt")

(defn actively-processing? [pane-text]
  (boolean (re-find busy-footer-pattern (or pane-text ""))))

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
