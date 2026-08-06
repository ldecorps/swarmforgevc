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
;; Thresholds are SPEC-DEPENDENT (from→to|type): warn ≈ p67 and escalate ≈
;; p97 of historical mailbox residence for that hop, falling through
;; *->to|type then the global conf pair when samples are sparse. Resolution
;; happens OUTSIDE decide-tier so the structural no-suppression guarantee
;; below is preserved.
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
   An absent/unreadable config degrades to the defaults, never a crash.
   These are the GLOBAL fallback pair; per-spec resolution (resolve-thresholds)
   prefers a calibrated percentile table when one exists."
  [project-root]
  (let [conf-text (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
                       (catch Exception _ nil))]
    {:warn-ms (parse-warn-ms conf-text)
     :escalate-ms (parse-escalate-ms conf-text)}))

;; ── spec-dependent percentile thresholds (warn ≈ p67 / top 33%, escalate ≈ p97 / top 3%) ─
;; Spec identity is the alarm's own (from→to, type) key. Threshold RESOLUTION
;; happens here — outside decide-tier — so the structural no-suppression
;; guarantee (acceptance-05) stays intact: decide-tier still never sees
;; :from/:to/:type. Sparse specs fall through *->to|type → global (the
;; coarser *->*|type row is still written into the table for observability,
;; but resolve-thresholds below does not consult it).

(def warn-percentile
  "Warn catches roughly the slowest third of historical ages for a spec."
  67)

(def escalate-percentile
  "Escalate catches roughly the slowest 3% of historical ages for a spec."
  97)

(def min-samples-for-calibration
  "Fewer samples than this cannot support a meaningful percentile box —
   fall through to a coarser key (or the global conf pair) instead of
   treating noise as a threshold."
  8)

(def min-warn-ms
  "BL-835: a REJECT GATE, not a floor. A raw warn percentile below this is
   sub-minute clock noise that has not earned a calibrated threshold - the
   key is simply not emitted (thresholds-from-samples returns nil), falling
   through to a coarser key or the global conf pair. Never clamp a sub-gate
   raw value up to this number; that invents a threshold the history never
   showed and false-alarms healthy in-flight work (BL-835)."
  60000)

(defn spec-key
  "Exact lookup key: \"from->to|type\". Blank parts become \"?\" so a missing
   header never collides with a real role/type name."
  [{:keys [from to type]}]
  (str (or (not-empty from) "?") "->" (or (not-empty to) "?") "|" (or (not-empty type) "?")))

(defn to-type-key
  "Fallback keyed only by holding recipient + type: \"*->to|type\"."
  [{:keys [to type]}]
  (str "*->" (or (not-empty to) "?") "|" (or (not-empty type) "?")))

(defn type-key
  "Coarsest typed fallback: \"*->*|type\"."
  [{:keys [type]}]
  (str "*->*|" (or (not-empty type) "?")))

(defn percentile-ms
  "Pure: p-th percentile over a non-empty seq of durations (ms). Uses the
   same ceil-rank rule as extension/src/metrics/stageDwell.ts so calibrator
   and reporter agree. nil when samples are empty."
  [samples-ms p]
  (let [sorted (vec (sort samples-ms))
        n (count sorted)]
    (when (pos? n)
      (let [idx (min (dec n) (max 0 (dec (long (Math/ceil (* (/ (double p) 100.0) n))))))]
        (nth sorted idx)))))

(defn thresholds-from-samples
  "Pure: durations → {:warn-ms :escalate-ms :n} at the warn/escalate
   percentiles, or nil when under min-samples-for-calibration OR when the
   raw warn percentile does not clear min-warn-ms (BL-835 reject gate - a
   sub-gate raw percentile has not earned a calibrated threshold and must
   fall through, never be clamped up to a fake one). Escalation is forced
   strictly above warn (a tiny/flat sample must not collapse the two tiers
   into one fire)."
  [samples-ms]
  (let [n (count samples-ms)]
    (when (>= n min-samples-for-calibration)
      (let [warn-ms (long (or (percentile-ms samples-ms warn-percentile) 0))]
        (when (>= warn-ms min-warn-ms)
          (let [esc-raw (or (percentile-ms samples-ms escalate-percentile) 0)
                escalate-ms (max (inc warn-ms) (long esc-raw))]
            {:warn-ms warn-ms :escalate-ms escalate-ms :n n}))))))

(defn build-threshold-table
  "Pure: seq of {:from :to :type :duration-ms} → a specs map keyed by
   exact / to-type / type fallback strings. Only keys that clear the
   min-sample gate are emitted."
  [dwell-records]
  (let [by-exact (group-by spec-key dwell-records)
        by-to-type (group-by to-type-key dwell-records)
        by-type (group-by type-key dwell-records)
        entry (fn [source samples]
                (when-let [t (thresholds-from-samples (map :duration-ms samples))]
                  (assoc t :source source)))]
    (into {}
          (concat
           (keep (fn [[k samples]]
                   (when-let [e (entry "exact" samples)] [k e]))
                 by-exact)
           (keep (fn [[k samples]]
                   (when-let [e (entry "to-type" samples)] [k e]))
                 by-to-type)
           (keep (fn [[k samples]]
                   (when-let [e (entry "type" samples)] [k e]))
                 by-type)))))

(defn resolve-thresholds
  "Pure: pick warn/escalate for one parcel. Prefers exact spec, then
   *->to|type, then the global conf pair. (The coarser *->*|type row is
   still written into the calibrated table for observability, but is NOT
   consulted here — a type-level mix of QA→specifier hops and rotation
   waits would mis-calibrate dormant pipeline roles.) Returns
   {:warn-ms :escalate-ms :resolved-via} — resolved-via is the matched key
   or \"global\". decide-tier never sees the route identity."
  [{:keys [from to type]} specs-table global-thresholds]
  (let [specs (or specs-table {})
        candidates [(spec-key {:from from :to to :type type})
                    (to-type-key {:to to :type type})]]
    (or (some (fn [k]
                (when-let [e (get specs k)]
                  (when (and (number? (:warn-ms e)) (number? (:escalate-ms e))
                             (pos? (:warn-ms e)) (pos? (:escalate-ms e))
                             (> (:escalate-ms e) (:warn-ms e)))
                    {:warn-ms (long (:warn-ms e))
                     :escalate-ms (long (:escalate-ms e))
                     :resolved-via k})))
              candidates)
        {:warn-ms (:warn-ms global-thresholds)
         :escalate-ms (:escalate-ms global-thresholds)
         :resolved-via "global"})))

(defn- parse-instant-ms
  "Pure: an ISO-8601 instant string to epoch millis, or nil when absent,
   blank, or unparseable - never throws."
  [s]
  (try
    (some-> s str str/trim not-empty java.time.Instant/parse .toEpochMilli)
    (catch Exception _ nil)))

(defn dwell-record-from-headers
  "Pure: one completed/abandoned handoff's headers → {:from :to :type
   :duration-ms} or nil. Duration prefers completed_at − enqueued_at (full
   mailbox residence), then dequeued_at − enqueued_at (queue wait only)."
  [{:keys [from to type enqueued_at dequeued_at completed_at]}]
  (let [enq (parse-instant-ms enqueued_at)
        deq (parse-instant-ms dequeued_at)
        comp (parse-instant-ms completed_at)
        duration (cond
                   (and enq comp (>= comp enq)) (- comp enq)
                   (and enq deq (>= deq enq)) (- deq enq)
                   :else nil)]
    (when (and duration (not-empty type))
      {:from from :to to :type type :duration-ms duration})))

(defn calibrate-threshold-table
  "Pure orchestration over already-parsed header maps: build the specs table
   and wrap it with calibration metadata."
  [header-maps now-ms]
  (let [records (keep dwell-record-from-headers header-maps)
        specs (build-threshold-table records)]
    {:calibratedAt now-ms
     :warnPercentile warn-percentile
     :escalatePercentile escalate-percentile
     :minSamples min-samples-for-calibration
     :sampleCount (count records)
     :specs specs}))

;; ── age (mirrors mono_router_lib's note-aged? precedence exactly) ──────────

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

(defn thresholds-file-path [daemon-dir]
  (str (fs/path daemon-dir "flow-watchdog-thresholds.json")))

(defn read-threshold-table
  "Durable calibrated specs map, or {} when absent/malformed — never a crash.
   Shape: {:calibratedAt :specs {\"from->to|type\" {:warn-ms :escalate-ms :n :source}}}.
   Spec keys are normalised to strings on read (cheshire keywordizes JSON
   object keys, which would break string lookup in resolve-thresholds)."
  [daemon-dir]
  (let [raw (or (read-json (thresholds-file-path daemon-dir)) {})
        specs (or (:specs raw) {})]
    (assoc raw :specs
           (into {}
                 (map (fn [[k v]]
                        [(if (keyword? k) (name k) (str k))
                         (if (map? v)
                           (into {} (map (fn [[kk vv]] [(keyword (name kk)) vv]) v))
                           v)])
                      specs)))))

(defn write-threshold-table! [daemon-dir table]
  (fs/create-dirs daemon-dir)
  (spit (thresholds-file-path daemon-dir) (json/generate-string table)))

(def threshold-recalibration-ms
  "Re-read completed audits and rewrite the percentile table at most this
   often — calibration walks every completed/abandoned handoff and must not
   run on every chase-cadence sweep."
  (* 6 60 60 1000))

(defn threshold-table-stale?
  "True when the durable table is missing, untimestamped, or older than
   threshold-recalibration-ms."
  [table now-ms]
  (let [at (:calibratedAt table)]
    (or (nil? at)
        (not (number? at))
        (>= (- now-ms (long at)) threshold-recalibration-ms))))

(defn calibration-headers-from-file
  "Impure: one handoff file → header map for dwell-record-from-headers, or
   nil when unreadable."
  [file-path]
  (try
    {:from (handoff-lib/header-field file-path "from")
     :to (handoff-lib/header-field file-path "to")
     :type (handoff-lib/header-field file-path "type")
     :enqueued_at (handoff-lib/header-field file-path "enqueued_at")
     :dequeued_at (handoff-lib/header-field file-path "dequeued_at")
     :completed_at (handoff-lib/header-field file-path "completed_at")}
    (catch Exception _ nil)))

(defn read-state
  "Keyed by parcel id -> {:tier :alarmedAt :snoozed}. Absent/malformed file
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

(defn collect-calibration-headers
  "Impure: every .handoff under the given dirs (completed/abandoned, incl.
   batch_*), as header maps. Absent dirs contribute nothing."
  [dirs]
  (vec (keep calibration-headers-from-file
             (mapcat list-handoff-files (remove nil? dirs)))))

(defn ensure-threshold-table!
  "Refresh the durable percentile table when stale. dirs: completed/abandoned
   mailbox paths across roles. Returns the (possibly freshly written) table.
   A calibration failure leaves the prior table in place — never disables
   the watchdog."
  [daemon-dir dirs now-ms]
  (let [current (read-threshold-table daemon-dir)]
    (if-not (threshold-table-stale? current now-ms)
      current
      (try
        (let [fresh (calibrate-threshold-table
                     (collect-calibration-headers dirs)
                     now-ms)]
          (write-threshold-table! daemon-dir fresh)
          fresh)
        (catch Exception _
          current)))))

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
;; adapters keys: :live-session? (fn [role] bool), :emit-alarm! (fn [text] ->
;; truthy on a CONFIRMED write, falsy or throw on a failed/uncertain one - see
;; run-sweep!'s docstring for why the return value gates durable state.

(defn run-sweep!
  "role-inboxes: seq of {:role :new-dir :in-process-dir optional :completed-dir
   :abandoned-dir}. Reads the effective GLOBAL config thresholds as fallback,
   refreshes the per-spec percentile table when stale (warn≈p67 / escalate≈p97
   of historical mailbox residence per from→to|type), resolves warn/escalate
   PER PARCEL outside decide-tier, scans every role's new/in_process
   mailboxes, alarms (via adapters' :emit-alarm!) on every parcel whose tier
   just changed, and persists the updated durable state - including pruning
   entries for parcels that have progressed out of new/in_process entirely.

   Alarm-recorded-on-CONFIRMED-write only (BL-577 bounce fix): a parcel's
   tier/alarmedAt is written to durable state ONLY when :emit-alarm! itself
   reports a confirmed write (truthy return). If :emit-alarm! returns falsy
   or throws (e.g. the Telegram outbox write failed), state is left exactly
   as it was for that parcel - so the NEXT sweep re-evaluates the same
   highest-tier-alarmed and re-attempts the alarm instead of silently
   treating an unconfirmed attempt as sent. Recording on attempt rather than
   confirmation would let one failed write permanently suppress a real
   flow-stall, defeating the ticket's unsuppressable-by-design invariant."
  [role-inboxes now-ms project-root daemon-dir adapters]
  (let [global (read-thresholds project-root)
        calib-dirs (mapcat (fn [row] [(:completed-dir row) (:abandoned-dir row)]) role-inboxes)
        table (ensure-threshold-table! daemon-dir calib-dirs now-ms)
        specs (:specs table {})
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
                   {:keys [warn-ms escalate-ms]} (resolve-thresholds parcel specs global)
                   tier (evaluate-parcel-tier age-ms warn-ms escalate-ms acc-state (:id parcel))]
               (if (= tier :none)
                 acc-state
                 (let [live? (boolean ((:live-session? adapters) (:role parcel)))
                       verb (decide-verb {:mailbox (:mailbox parcel) :live-session? live?})
                       text (format-alarm-text (assoc parcel :age-ms age-ms :verb verb :tier tier))
                       confirmed? (try
                                    (boolean ((:emit-alarm! adapters) text))
                                    (catch Exception _ false))]
                   (if confirmed?
                     (assoc acc-state (keyword (:id parcel))
                            (assoc (get acc-state (keyword (:id parcel)) {})
                                   :tier (name tier) :alarmedAt now-ms))
                     acc-state))))))
         pruned-state
         parcels)]
    (write-state! daemon-dir final-state)))
