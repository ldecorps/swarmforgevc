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
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_identity_lib.bb")))
;; BL-650: the ledger's own sole reader (BL-823) - this lib subtracts what
;; it folds, never re-parses the JSONL itself.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "availability_ledger_lib.bb")))

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

;; ── BL-650: pack-aware GLOBAL fallback (rotation-aware thresholds) ─────────
;; Item 2 of the ticket's shape: under a `rotation router` pack a broadcast
;; parcel waiting its rotation turn in a dormant role's inbox is a NOMINAL
;; wait, not a stall - decide-tier itself stays untouched (no role/type/
;; dormancy branch, acceptance-05); only the GLOBAL warn/escalate pair fed
;; into resolve-thresholds changes, exactly the same "config in, decide-tier
;; untouched" shape as the spec-dependent percentile resolution above.

(def default-router-warn-ms
  "30 minutes - a rotation-router pack serialises every role through one
   resident, so a broadcast parcel waiting its turn in a dormant role's
   inbox is a nominal rotation wait. Generous relative to
   default-warn-ms (15m), which is calibrated for a parallel/all-resident
   pack where 15m in inbox/new means dispatch is broken (BL-650 scenario 06)."
  1800000)

(def default-router-escalate-ms
  "3 hours - proportionally generous with default-router-warn-ms, same
   rotation-wait rationale."
  10800000)

(defn parse-router-warn-ms [conf-text]
  (parse-ms-config conf-text "flow_watchdog_router_warn_ms" default-router-warn-ms))

(defn parse-router-escalate-ms [conf-text]
  (parse-ms-config conf-text "flow_watchdog_router_escalate_ms" default-router-escalate-ms))

(defn read-pack-aware-global-thresholds
  "The GLOBAL fallback pair, pack-aware. Under `config rotation router`
   (swarm-identity-lib/conf-rotation-mode on the EFFECTIVE conf, same
   BL-313 resolution read-thresholds already uses) the router-specific
   pair applies; every other pack (sequential, or no rotation directive at
   all - a parallel/all-resident pack) keeps the plain
   flow_watchdog_warn_ms/escalate_ms pair, byte-for-byte what
   read-thresholds already returns. An absent/unreadable config degrades to
   defaults exactly like read-thresholds - never a crash, never a disabled
   watchdog."
  [project-root]
  (let [conf-path (backlog-depth-lib/conf-file-path project-root)
        conf-text (try (slurp (str conf-path)) (catch Exception _ nil))
        router? (= "router" (swarm-identity-lib/conf-rotation-mode conf-path))]
    (if router?
      {:warn-ms (parse-router-warn-ms conf-text) :escalate-ms (parse-router-escalate-ms conf-text)}
      {:warn-ms (parse-warn-ms conf-text) :escalate-ms (parse-escalate-ms conf-text)})))

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
  (let [entry (fn [source samples]
                (when-let [t (thresholds-from-samples (map :duration-ms samples))]
                  (assoc t :source source)))
        fallback-levels [[spec-key "exact"]
                          [to-type-key "to-type"]
                          [type-key "type"]]]
    (into {}
          (mapcat (fn [[key-fn source]]
                    (keep (fn [[k samples]]
                            (when-let [e (entry source samples)] [k e]))
                          (group-by key-fn dwell-records)))
                  fallback-levels))))

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

(defn- age-source-instant-ms
  "The shared age-SOURCE resolver behind both parcel-age-ms (wall clock) and
   evaluate-effective-age (BL-650 active-time clock): the first PARSEABLE of
   enqueued_at, then created_at - enqueued_at leads because it answers 'how
   long has this sat in THIS mailbox' (a redelivered parcel is fresh here
   even when created long ago). nil when neither header parses."
  [{:keys [enqueued-at created-at]}]
  (or (parse-instant-ms enqueued-at) (parse-instant-ms created-at)))

(defn parcel-age-ms
  "Age source is the first PARSEABLE of enqueued_at, then created_at -
   enqueued_at leads because it answers 'how long has this sat in THIS
   mailbox' (a redelivered parcel is fresh here even when created long ago).
   File mtime is NEVER consulted (worktree hot-sync touches files - the same
   reason BL-576's note-aged? excludes it). nil when neither header parses -
   fails closed: the caller (decide-tier) treats nil age as never-alarming
   rather than guessing."
  [{:keys [enqueued-at created-at now-ms]}]
  (when-let [age-source (age-source-instant-ms {:enqueued-at enqueued-at :created-at created-at})]
    (- now-ms age-source)))

;; ── BL-650: active-time clock (effective age) ───────────────────────────────
;; Item 1 of the ticket's shape: effective age = wall age minus every
;; interval the swarm could not process, evidenced only by durable records -
;; never a guess (invariant 2). decide-tier itself is never touched; it is
;; simply handed effective-age-ms instead of wall age-ms, so the structural
;; no-suppression guarantee (acceptance-05) is untouched by construction.

(defn- clip-interval-ms
  "Pure: overlap length in ms between {:start-ms :end-ms} (end-ms nil is
   treated as open, clipped to span-end) and [span-start span-end]. Zero for
   no overlap, an out-of-order/corrupt start>end, or an interval entirely
   outside the span - never negative, never throws."
  [{:keys [start-ms end-ms]} span-start span-end]
  (let [s (max (long start-ms) (long span-start))
        e (min (long (or end-ms span-end)) (long span-end))]
    (max 0 (- e s))))

(defn merge-and-sum-ms
  "Pure: total ms covered by the UNION of `intervals` (each {:start-ms
   :end-ms}, end-ms already resolved - never nil here) once clipped to
   [span-start span-end]. Overlapping, nested, zero-length and out-of-order
   intervals are merged into non-overlapping runs before summing, so no
   span is ever counted twice regardless of how the inputs overlap
   (BL-650 invariant 1). Public (not `defn-`) so property tests can drive
   it directly against an independent oracle."
  [intervals span-start span-end]
  (let [clipped (->> intervals
                      (map (fn [{:keys [start-ms end-ms]}]
                             [(max (long start-ms) (long span-start))
                              (min (long end-ms) (long span-end))]))
                      (filter (fn [[s e]] (< s e)))
                      (sort-by first))]
    (loop [remaining clipped
           cur-start nil
           cur-end nil
           total 0]
      (if-let [[s e] (first remaining)]
        (cond
          (nil? cur-start) (recur (rest remaining) s e total)
          (<= s cur-end) (recur (rest remaining) cur-start (max cur-end e) total)
          :else (recur (rest remaining) s e (+ total (- cur-end cur-start))))
        (+ total (if cur-start (- cur-end cur-start) 0))))))

(defn- resolve-open-ledger-interval
  "Applies BL-650's ruling on BL-823's `open` provenance to one ledger
   interval:
   - control-pause, open (end-ms nil): a pause with no end record is
     happening RIGHT NOW - a currently-true fact, not a guess - so it
     resolves to now-ms (subtracted up to the sweep's own now).
   - swarm-stop, open: if the swarm were genuinely stopped this sweep would
     not be running, so an open stop observed at sweep time is a stale
     record from an ungraceful exit - it is DROPPED (contributes no
     subtraction) and the caller flags it unreconstructable instead
     (fail-toward-wall-clock, invariant 2).
   - already closed (proven/inferred), either class: end-ms is already a
     real record - passed through unchanged."
  [{:keys [end-ms class] :as interval} now-ms]
  (cond
    (some? end-ms) interval
    (= class "control-pause") (assoc interval :end-ms now-ms)
    :else nil))

(def default-provider-outage-max-gap-ms
  "10 minutes - see provider-outage-intervals."
  600000)

(defn provider-outage-intervals
  "Pure: a seq of {:ts-ms :provider :text} SIGNATURE-BACKED evidence lines
   (already scanned and classified by the caller - reading a live pane or
   role transcript is environmental/impure and stays outside this lib, per
   this project's testability-boundary convention) -> a vector of
   {:start-ms :end-ms :provider} intervals, one per contiguous same-provider
   burst. Consecutive same-provider lines closer together than max-gap-ms
   join one interval; a larger gap starts a new one, so two unrelated
   retries far apart are never merged into one enormous subtraction
   (BL-650 scenario 08). No evidence for a provider yields no interval for
   it - the caller's span then falls back to wall clock for that stretch,
   unchanged (invariant 2)."
  ([lines] (provider-outage-intervals lines default-provider-outage-max-gap-ms))
  ([lines max-gap-ms]
   (vec
    (mapcat
     (fn [[provider provider-lines]]
       (let [sorted (sort-by :ts-ms provider-lines)]
         (reduce
          (fn [intervals {:keys [ts-ms]}]
            (if-let [last-interval (peek intervals)]
              (if (<= (- ts-ms (:end-ms last-interval)) max-gap-ms)
                (conj (pop intervals) (assoc last-interval :end-ms ts-ms))
                (conj intervals {:start-ms ts-ms :end-ms ts-ms :provider provider}))
              (conj intervals {:start-ms ts-ms :end-ms ts-ms :provider provider})))
          []
          sorted)))
     (group-by :provider lines)))))

(defn evaluate-effective-age
  "Pure: BL-650's active-time clock for one parcel. Mirrors parcel-age-ms's
   own enqueued_at/created_at precedence for the age SOURCE (never mtime),
   then subtracts every ledger (BL-823) and provider-outage interval that
   overlaps [age-source now-ms] - ledger and provider-outage intervals are
   merged into ONE union before summing, so an interval from either class
   overlapping another is never double-subtracted (invariant 1). Clamped
   to [0, wall-age-ms] so effective age is never negative and never exceeds
   wall age, for ANY interval shape - overlapping, nested, zero-length,
   out-of-order, or still-open (invariant 1). nil enqueued-at/created-at
   (age source unparseable) yields all-nil age fields - fails closed
   exactly like parcel-age-ms, never a guess.
   ledger-intervals: BL-823's availability-ledger-lib/fold output, any
     order - {:start-ms :end-ms :class :provenance}.
   provider-evidence: seq of {:ts-ms :provider :text}, see
     provider-outage-intervals.
   Returns {:effective-age-ms :wall-age-ms :outage-intervals
            :unreconstructable?} - effective-age-ms is what decide-tier
   must be given; the rest is for format-alarm-text only."
  [{:keys [enqueued-at created-at now-ms ledger-intervals provider-evidence]}]
  (if-let [age-source (age-source-instant-ms {:enqueued-at enqueued-at :created-at created-at})]
    (let [span-start age-source
          span-end now-ms
          wall-age-ms (max 0 (- now-ms age-source))
          resolved-ledger (keep #(resolve-open-ledger-interval % now-ms) ledger-intervals)
          unreconstructable?
          (boolean
           (some (fn [{:keys [end-ms class] :as iv}]
                   (and (nil? end-ms) (= class "swarm-stop")
                        (pos? (clip-interval-ms iv span-start span-end))))
                 ledger-intervals))
          outages (provider-outage-intervals (or provider-evidence []))
          overlapping-outages (filterv #(pos? (clip-interval-ms % span-start span-end)) outages)
          total-subtracted-ms (merge-and-sum-ms (concat resolved-ledger outages) span-start span-end)
          effective-ms (max 0 (min wall-age-ms (- wall-age-ms total-subtracted-ms)))]
      {:effective-age-ms effective-ms
       :wall-age-ms wall-age-ms
       :outage-intervals overlapping-outages
       :unreconstructable? unreconstructable?})
    {:effective-age-ms nil :wall-age-ms nil :outage-intervals [] :unreconstructable? false}))

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
   operator can act without archaeology, per the ticket.
   age-ms is the clock decide-tier actually used (effective age under
   BL-650; unchanged callers still pass wall age, and the text is
   byte-for-byte what it always was). Three keys are BL-650 additions, all
   optional and all no-ops when absent, so every pre-existing caller/test
   is unaffected:
   - wall-age-ms: when present and different from age-ms, appends the
     active-vs-wall reading (BL-650 scenario 07).
   - outage-intervals: when non-empty, names each subtracted
     provider-outage interval (scenario 07/08).
   - unreconstructable?: when true, flags that a pause/stop interval could
     not be reconstructed and fell back to wall clock (scenario 05)."
  [{:keys [id from to type age-ms wall-age-ms role mailbox verb tier
           outage-intervals unreconstructable?]}]
  (str (if (= tier :escalate) "🚨 ESCALATE" "⚠️ WARN")
       " flow-stall: parcel " id " (" from "->" to ", " type ") aged "
       (humanize-age-ms age-ms) " in " role " " (name mailbox)
       " - " (name verb) "."
       (when (and wall-age-ms (not= (long wall-age-ms) (long (or age-ms 0))))
         (str " (active " (humanize-age-ms age-ms) " of " (humanize-age-ms wall-age-ms) " wall)"))
       (when (seq outage-intervals)
         (str " Subtracted provider outage: "
              (str/join ", " (map (fn [{:keys [provider start-ms end-ms]}]
                                     (str provider " " (humanize-age-ms (max 0 (- end-ms start-ms)))))
                                   outage-intervals))
              "."))
       (when unreconstructable?
         " A pause/stop interval could not be reconstructed - fell back to wall clock for that span.")))

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
   :abandoned-dir}. Reads the effective GLOBAL config thresholds as fallback
   (BL-650: pack-aware - the router-specific pair under `config rotation
   router`), refreshes the per-spec percentile table when stale (warn≈p67 /
   escalate≈p97 of historical mailbox residence per from→to|type), resolves
   warn/escalate PER PARCEL outside decide-tier, scans every role's
   new/in_process mailboxes, computes each parcel's BL-650 ACTIVE-TIME age
   (wall age minus BL-823 ledger + provider-outage intervals - see
   evaluate-effective-age), alarms (via adapters' :emit-alarm!) on every
   parcel whose tier just changed, and persists the updated durable state -
   including pruning entries for parcels that have progressed out of
   new/in_process entirely.

   adapters' BL-650 addition: :provider-outage-evidence-for (fn [role] -> seq
   of {:ts-ms :provider :text}), optional - defaults to no evidence, so an
   omitted adapter (every pre-BL-650 caller) subtracts no provider-outage
   time and behaves exactly as before wherever the ledger itself is also
   empty.

   Alarm-recorded-on-CONFIRMED-write only (BL-577 bounce fix): a parcel's
   tier/alarmedAt is written to durable state ONLY when :emit-alarm! itself
   reports a confirmed write (truthy return). If :emit-alarm! returns falsy
   or throws (e.g. the Telegram outbox write failed), state is left exactly
   as it was for that parcel - so the NEXT sweep re-evaluates the same
   highest-tier-alarmed and re-attempts the alarm instead of silently
   treating an unconfirmed attempt as sent. Recording on attempt rather than
   confirmation would let one failed write permanently suppress a real
   flow-stall, defeating the ticket's unsuppressable-by-design invariant.
   This same gate is what makes BL-650 invariant 3 hold for free: decide-tier
   only ever WRITES a tier forward (nil->:warn, or ->:escalate when not
   already :escalate - see decide-tier), and a :none verdict never touches
   state at all, so no later sweep - however effective age fluctuates as
   fresher interval evidence lands - can ever downgrade an already-recorded
   tier."
  [role-inboxes now-ms project-root daemon-dir adapters]
  (let [global (read-pack-aware-global-thresholds project-root)
        calib-dirs (mapcat (fn [row] [(:completed-dir row) (:abandoned-dir row)]) role-inboxes)
        table (ensure-threshold-table! daemon-dir calib-dirs now-ms)
        specs (:specs table {})
        state (read-state daemon-dir)
        state-dir (fs/parent daemon-dir)
        ledger-intervals (try (availability-ledger-lib/fold state-dir) (catch Exception _ []))
        provider-evidence-for (or (:provider-outage-evidence-for adapters) (constantly []))
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
             (let [eff (evaluate-effective-age
                        {:enqueued-at (:enqueued-at parcel)
                         :created-at (:created-at parcel)
                         :now-ms now-ms
                         :ledger-intervals ledger-intervals
                         :provider-evidence (provider-evidence-for (:role parcel))})
                   age-ms (:effective-age-ms eff)
                   {:keys [warn-ms escalate-ms]} (resolve-thresholds parcel specs global)
                   tier (evaluate-parcel-tier age-ms warn-ms escalate-ms acc-state (:id parcel))]
               (if (= tier :none)
                 acc-state
                 (let [live? (boolean ((:live-session? adapters) (:role parcel)))
                       verb (decide-verb {:mailbox (:mailbox parcel) :live-session? live?})
                       text (format-alarm-text
                             (assoc parcel :age-ms age-ms :wall-age-ms (:wall-age-ms eff)
                                    :outage-intervals (:outage-intervals eff)
                                    :unreconstructable? (:unreconstructable? eff)
                                    :verb verb :tier tier))
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
