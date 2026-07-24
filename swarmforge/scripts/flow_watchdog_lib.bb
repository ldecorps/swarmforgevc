;; BL-577: flow watchdog - no parcel sits unprocessed beyond a threshold, any
;; mailbox, any type; alarm path is unsuppressable by design.
;;
;; Every self-heal layer in this swarm (chase/nudge/respawn, swarm ensure,
;; config self-heal, session heal, babysitter, supervisors) measures
;; LIVENESS, not FLOW - all signals can read green while a parcel sits
;; unprocessed in an inbox for hours (dormant role, dead-lettered note,
;; unforwarded in_process item). This lib is the FLOW invariant: age a
;; parcel from its own enqueued_at/created_at header (never mtime, since
;; worktree hot-sync touches files), and alarm on a durable, unsuppressable
;; path once it crosses a warn/escalate threshold.
;;
;; Host: a handoffd sweep sibling (design decision, ticket option (a)) -
;; handoffd already owns role enumeration (BL-128's mailbox-dir/
;; load-all-roles), header parsing, and the durable Telegram OPERATOR-topic
;; outbox (loop_detect_lib.bb / claim_progress_lib.bb's own halt alarms use
;; the same outbox file).
;;
;; Structural no-suppression guarantee: decide-tier's input map carries only
;; {:age-ms :warn-ms :escalate-ms :highest-tier-alarmed :snoozed?} - no role,
;; type, or dormancy key ever reaches it, so no role/type/dormancy-based
;; suppression clause can exist in the decision (acceptance scenario 05).
;; Per-parcel snooze (a human ack, read here only - the writer is a later
;; slice) is the only mute, and it stays visible state in the durable file.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "flow_watchdog_lib.bb")))
;; and referred to as flow-watchdog-lib/foo.

(ns flow-watchdog-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

;; ── config (BL-216/BL-313 conf-file-path pattern) ───────────────────────────

(def default-warn-ms
  "15 minutes - matches the ticket's `config flow_watchdog_warn_ms 900000`."
  900000)

(def default-escalate-ms
  "1 hour - matches the ticket's `config flow_watchdog_escalate_ms 3600000`."
  3600000)

(defn- parse-ms-config
  "Pure: key-name's value from swarmforge.conf's own text, or default when
   the line is absent, unparseable, or non-positive - a non-positive value
   here is nonsensical (would fire an alarm on every parcel, effectively an
   ill-defined threshold) so it degrades to default exactly like absent,
   never a crash and never a value that disables the watchdog."
  [conf-text key-name default]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % (str "config " key-name)))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) n default)))

(defn parse-warn-ms [conf-text]
  (parse-ms-config conf-text "flow_watchdog_warn_ms" default-warn-ms))

(defn parse-escalate-ms [conf-text]
  (parse-ms-config conf-text "flow_watchdog_escalate_ms" default-escalate-ms))

(defn read-thresholds
  "The impure fs-reading half: reads the EFFECTIVE config (backlog-depth-lib's
   own conf-file-path, so a --pack/SWARMFORGE_CONFIG override is honored the
   same way active_backlog_max_depth already is) and parses both thresholds.
   An absent/unreadable config degrades to the defaults, never a crash."
  [project-root]
  (let [conf-text (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
                       (catch Exception _ nil))]
    {:warn-ms (parse-warn-ms conf-text)
     :escalate-ms (parse-escalate-ms conf-text)}))

;; ── age (mirrors mono_router_lib's note-aged? precedence exactly) ──────────

(defn- parse-instant-ms
  "Pure: an ISO-8601 instant string to epoch millis, or nil when absent,
   blank, or unparseable - never throws."
  [s]
  (try
    (some-> s str str/trim not-empty java.time.Instant/parse .toEpochMilli)
    (catch Exception _ nil)))

(defn parcel-age-ms
  "Age source is the first PARSEABLE of enqueued_at, then created_at -
   enqueued_at leads because it answers 'how long has this sat in THIS
   mailbox' (a redelivered parcel is fresh here even when created long ago).
   File mtime is NEVER consulted (worktree hot-sync touches files - the same
   reason BL-576's note-aged? excludes it). nil when neither header parses -
   fails closed: the caller (decide-tier) treats nil age as never-alarming
   rather than guessing."
  [{:keys [enqueued-at created-at now-ms]}]
  (when-let [age-source (or (parse-instant-ms enqueued-at) (parse-instant-ms created-at))]
    (- now-ms age-source)))

;; ── structurally suppression-free tier decision ─────────────────────────────

(def tier-decision-input-keys
  "The COMPLETE allowed-key set for decide-tier's input map - documents and
   unit-tests the structural no-suppression guarantee (acceptance scenario
   05). decide-tier's own destructuring only ever binds these five keys, so
   a :role/:type/:dormancy key slipped into the input map by a future caller
   is simply never bound/read - structurally inert, not merely policy."
  #{:age-ms :warn-ms :escalate-ms :highest-tier-alarmed :snoozed?})

(defn decide-tier
  "Pure: {:age-ms :warn-ms :escalate-ms :highest-tier-alarmed :snoozed?} ->
   :none | :warn | :escalate.
   - snoozed? true mutes unconditionally - the ONLY mute this function
     recognizes, and it is visible state in the durable state file, never a
     role/type/dormancy branch.
   - nil age-ms (neither header parsed) never alarms - fails closed.
   - highest-tier-alarmed is nil | :warn | :escalate - the parcel's own prior
     alarm tier, so a re-alarm fires only on a TIER CHANGE (crossing into
     escalate), never a repeat within the same tier."
  [{:keys [age-ms warn-ms escalate-ms highest-tier-alarmed snoozed?]}]
  (cond
    snoozed? :none
    (nil? age-ms) :none
    (< age-ms warn-ms) :none
    (and (>= age-ms escalate-ms) (not= highest-tier-alarmed :escalate)) :escalate
    (and (>= age-ms warn-ms) (nil? highest-tier-alarmed)) :warn
    :else :none))

;; ── verb table (pure, outside the tier decision) ────────────────────────────

(defn decide-verb
  "Which unblock verb to prescribe, per the ticket's verb table:
   - holder role has no live session -> :rotate
   - in_process with a live session -> :investigate
   - inbox/new with a live session -> :expedite (BL-567)
   Kept OUTSIDE decide-tier: the verb depends on role/mailbox liveness (real
   signals worth surfacing to the human), but never on WHETHER to alarm -
   that split is what keeps the tier decision itself suppression-free."
  [{:keys [mailbox live-session?]}]
  (cond
    (not live-session?) :rotate
    (= mailbox :in_process) :investigate
    :else :expedite))

;; ── durable state (.swarmforge/daemon/flow-watchdog-state.json) ────────────

(defn state-file-path [daemon-dir]
  (str (fs/path daemon-dir "flow-watchdog-state.json")))

(defn- read-json [path]
  (try (json/parse-string (slurp path) true) (catch Exception _ nil)))

(defn read-state
  "Keyed by parcel id -> {:tier :alarmedAt :snoozed?}. Absent/malformed file
   degrades to {} - never a crash."
  [daemon-dir]
  (or (read-json (state-file-path daemon-dir)) {}))

(defn write-state! [daemon-dir state]
  (fs/create-dirs daemon-dir)
  (spit (state-file-path daemon-dir) (json/generate-string state)))

(defn highest-tier-alarmed
  "The parcel's own prior alarm tier from state (nil | :warn | :escalate)."
  [state parcel-id]
  (some-> (get state (keyword parcel-id)) :tier keyword))

(defn snoozed?
  "True when the parcel carries a human-ack snooze entry. Snooze WRITING is a
   later slice (out of scope, per the ticket); this reads whatever is
   already present in the state file."
  [state parcel-id]
  (boolean (:snoozed (get state (keyword parcel-id)))))

(defn prune-progressed-entries
  "Given the state map and the set of parcel ids CURRENTLY present in any
   watched mailbox (new/in_process, every role), returns the state with every
   entry whose id is no longer present removed - a parcel that progressed
   (claimed to completion, abandoned, or reaped) never re-alarms, and its
   stale tier/alarmedAt bookkeeping does not linger forever."
  [state present-ids]
  (let [present (set present-ids)]
    (into {} (filter (fn [[k _]] (contains? present (name k))) state))))

;; ── scanning: every role's inbox/new + inbox/in_process, incl. batch dirs ──
;; Mirrors chase_sweep_lib.bb's own scan-in-process batch-recursion exactly.

(defn- list-handoff-files [dir]
  (if-not (fs/exists? dir)
    []
    (mapcat (fn [entry]
              (let [name (fs/file-name entry)]
                (cond
                  (and (fs/directory? entry) (str/starts-with? name "batch_"))
                  (list-handoff-files entry)

                  (str/ends-with? name ".handoff")
                  [(str entry)]

                  :else [])))
            (fs/list-dir dir))))

(defn parcel-record
  "One scanned parcel's identity + age-relevant headers, read via
   handoff-lib's shared header-field reader (BL-128) - never a second,
   drifting header parser."
  [file-path]
  {:id (handoff-lib/header-field file-path "id")
   :file-path file-path
   :type (handoff-lib/header-field file-path "type")
   :from (handoff-lib/header-field file-path "from")
   :to (handoff-lib/header-field file-path "to")
   :enqueued-at (handoff-lib/header-field file-path "enqueued_at")
   :created-at (handoff-lib/header-field file-path "created_at")})

(defn scan-mailbox-dir [dir]
  (vec (map parcel-record (list-handoff-files dir))))

;; ── humanized age + alarm text ───────────────────────────────────────────────

(defn humanize-age-ms
  "e.g. 1500000 -> \"25m\", 5400000 -> \"1h30m\". Never negative (a clock
   skew or same-tick sweep clamps to 0)."
  [age-ms]
  (let [total-seconds (quot (max 0 (long (or age-ms 0))) 1000)
        hours (quot total-seconds 3600)
        minutes (quot (mod total-seconds 3600) 60)]
    (if (pos? hours)
      (str hours "h" minutes "m")
      (str minutes "m"))))

(defn format-alarm-text
  "Payload: parcel id, from->to, type, humanized age, holding mailbox (role +
   new|in_process), and the prescribed unblock verb - so the human or
   operator can act without archaeology, per the ticket."
  [{:keys [id from to type age-ms role mailbox verb tier]}]
  (str (if (= tier :escalate) "🚨 ESCALATE" "⚠️ WARN")
       " flow-stall: parcel " id " (" from "->" to ", " type ") aged "
       (humanize-age-ms age-ms) " in " role " " (name mailbox)
       " - " (name verb) "."))

;; ── per-parcel evaluation (bridges a scanned parcel + state into decide-tier) ─

(defn evaluate-parcel-tier
  "Assembles decide-tier's structurally-constrained input map from an age-ms,
   warn/escalate thresholds, and durable state. Kept separate from
   decide-tier itself so the acceptance-05 structural guarantee lives on the
   decision fn alone, never on this convenience wrapper."
  [age-ms warn-ms escalate-ms state parcel-id]
  (decide-tier
   {:age-ms age-ms
    :warn-ms warn-ms
    :escalate-ms escalate-ms
    :highest-tier-alarmed (highest-tier-alarmed state parcel-id)
    :snoozed? (snoozed? state parcel-id)}))

;; ── impure sweep application ─────────────────────────────────────────────────
;; adapters keys: :live-session? (fn [role] bool), :emit-alarm! (fn [text]).

(defn run-sweep!
  "role-inboxes: seq of {:role :new-dir :in-process-dir}. Reads the effective
   config thresholds, scans every role's new/in_process mailboxes, alarms
   (via adapters' :emit-alarm!) on every parcel whose tier just changed, and
   persists the updated durable state - including pruning entries for
   parcels that have progressed out of new/in_process entirely."
  [role-inboxes now-ms project-root daemon-dir adapters]
  (let [{:keys [warn-ms escalate-ms]} (read-thresholds project-root)
        state (read-state daemon-dir)
        parcels (vec (mapcat
                      (fn [{:keys [role new-dir in-process-dir]}]
                        (concat
                         (map #(assoc % :role role :mailbox :new) (scan-mailbox-dir new-dir))
                         (map #(assoc % :role role :mailbox :in_process) (scan-mailbox-dir in-process-dir))))
                      role-inboxes))
        present-ids (set (keep :id parcels))
        pruned-state (prune-progressed-entries state present-ids)
        final-state
        (reduce
         (fn [acc-state parcel]
           (if (str/blank? (:id parcel))
             acc-state
             (let [age-ms (parcel-age-ms {:enqueued-at (:enqueued-at parcel)
                                           :created-at (:created-at parcel)
                                           :now-ms now-ms})
                   tier (evaluate-parcel-tier age-ms warn-ms escalate-ms acc-state (:id parcel))]
               (if (= tier :none)
                 acc-state
                 (let [live? (boolean ((:live-session? adapters) (:role parcel)))
                       verb (decide-verb {:mailbox (:mailbox parcel) :live-session? live?})
                       text (format-alarm-text (assoc parcel :age-ms age-ms :verb verb :tier tier))]
                   ((:emit-alarm! adapters) text)
                   (assoc acc-state (keyword (:id parcel))
                          (assoc (get acc-state (keyword (:id parcel)) {})
                                 :tier (name tier) :alarmedAt now-ms)))))))
         pruned-state
         parcels)]
    (write-state! daemon-dir final-state)))
