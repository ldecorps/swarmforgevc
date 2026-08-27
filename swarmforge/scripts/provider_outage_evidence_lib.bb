;; BL-840: durable store for provider-unavailability evidence observed on
;; live role panes, so handoffd's flow-watchdog sweep can subtract it from
;; a waiting parcel's effective age (BL-650's provider-outage-intervals,
;; built and hardened but never fed a real evidence source in production).
;;
;; Mirrors availability_ledger_lib.bb (BL-823) exactly: one lib is the sole
;; writer AND sole reader of `.swarmforge/telemetry/provider-outage-
;; YYYY-MM.jsonl`, and nothing else parses that file. Unlike BL-823's
;; ledger, this lib both WRITES (record-provider-outage!, called from the
;; daemon's live pane-observation tick) and READS (evidence-for-provider,
;; called from flow-watchdog-sweep!'s adapter) - there is no separate TS/sh
;; writer twin, because the only producer is the daemon's own pane
;; observation, which is Babashka already.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "provider_outage_evidence_lib.bb")))
;; and referred to as provider-outage-evidence-lib/foo.

(ns provider-outage-evidence-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; ── config: provider_outage_observe_min_interval_ms ─────────────────────

(def default-observe-min-interval-ms
  "60 seconds - see swarmforge.conf's own commented documentation of this
   default (single source of truth: swarmforge.conf documents it as a
   COMMENTED line rather than duplicating the literal, so the two cannot
   drift apart). Well inside flow_watchdog_lib.bb's own
   default-provider-outage-max-gap-ms (600000), so a throttled observation
   stream still gap-groups a standing banner into one contiguous interval."
  60000)

(defn parse-observe-min-interval-ms
  "Pure: `config provider_outage_observe_min_interval_ms <ms>` from conf
   text - same shape as mono_router_lib.bb's parse-note-actionable-after-ms.
   Honors a POSITIVE integer only; absent, malformed, zero, and negative all
   degrade to the default (a zero/negative interval would mean an unbounded
   observation stream, exactly the per-sweep write-volume growth this knob
   exists to bound)."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config provider_outage_observe_min_interval_ms"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) n default-observe-min-interval-ms)))

;; ── durable store: .swarmforge/telemetry/provider-outage-YYYY-MM.jsonl ──

(defn telemetry-dir [state-dir]
  (fs/path state-dir "telemetry"))

(def ^:private evidence-file-name-pattern #"^provider-outage-\d{4}-\d{2}\.jsonl$")

(defn- month-file-name [now-ms]
  (str "provider-outage-"
       (.format (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM")
                (java.time.ZonedDateTime/ofInstant (java.time.Instant/ofEpochMilli now-ms) java.time.ZoneOffset/UTC))
       ".jsonl"))

(defn evidence-files
  "Every monthly evidence file under state-dir/telemetry, sorted
   chronologically (fixed-width YYYY-MM filenames sort lexically ==
   chronologically). Empty when the telemetry dir does not exist yet -
   never a crash on a fresh project (invariant 1)."
  [state-dir]
  (let [dir (telemetry-dir state-dir)]
    (if-not (fs/exists? dir)
      []
      (->> (fs/list-dir dir)
           (filter #(re-matches evidence-file-name-pattern (fs/file-name %)))
           (map str)
           sort
           vec))))

(defn- parse-instant-ms [ts]
  (try (.toEpochMilli (java.time.Instant/parse ts)) (catch Exception _ nil)))

(defn- parse-record
  "One JSONL line -> {:ts :role :provider :text}, or nil for a blank,
   malformed-JSON, missing-field, or unparseable-timestamp line - skipped,
   never crashing the read (invariant 1)."
  [line]
  (when-not (str/blank? line)
    (try
      (let [parsed (json/parse-string line true)
            ts (:ts parsed)
            role (:role parsed)
            provider (:provider parsed)
            text (:text parsed)]
        (when (and (string? ts) (string? role) (string? provider) (string? text) (parse-instant-ms ts))
          {:ts ts :role role :provider provider :text text}))
      (catch Exception _ nil))))

(defn read-records
  "Every valid record across every monthly evidence file, sorted
   chronologically by :ts. A missing telemetry dir, an unreadable file, or
   any corrupt line degrades to skipping that piece, never throwing
   (invariant 1) - mirrors availability_ledger_lib.bb/read-records exactly."
  [state-dir]
  (try
    (->> (evidence-files state-dir)
         (mapcat (fn [f] (try (str/split-lines (slurp f)) (catch Exception _ []))))
         (keep parse-record)
         (sort-by :ts)
         vec)
    (catch Exception _ [])))

(defn evidence-for-provider
  "Every recorded line for `provider`, in flow_watchdog_lib.bb's
   provider-outage-intervals input shape ({:ts-ms :provider :text}) -
   attributed by PROVIDER, never by the role/pane the line was observed on
   (invariant 3). handoffd.bb's adapter closure resolves a role to its
   configured provider (the BL-208 lookup) before calling this - this lib
   itself never looks at roles.tsv."
  [state-dir provider]
  (->> (read-records state-dir)
       (filter #(= (:provider %) provider))
       (map (fn [r] {:ts-ms (parse-instant-ms (:ts r)) :provider (:provider r) :text (:text r)}))
       vec))

;; ── producer: record-provider-outage! ────────────────────────────────────

(defn- last-recorded-ms-for-role
  "The most recent recorded observation's ts-ms for this role specifically
   (the throttle key is the OBSERVING role/pane, not the provider - two
   roles on the same provider each get their own 60s budget, since they are
   independent observation streams even though their evidence is later
   merged by provider on the read side). nil when none exists or the store
   cannot be read - a throttle check that cannot prove a recent write must
   not block a real one (invariant 1's fail-closed posture applied to the
   producer side too)."
  [state-dir role]
  (let [ts-values (->> (read-records state-dir)
                        (filter #(= (:role %) role))
                        (keep (comp parse-instant-ms :ts))
                        seq)]
    (when ts-values (apply max ts-values))))

(defn- iso-of [ms]
  (.toString (java.time.Instant/ofEpochMilli ms)))

(defn- append-line! [state-dir record]
  (let [dir (telemetry-dir state-dir)
        file (fs/path dir (month-file-name (parse-instant-ms (:ts record))))]
    (fs/create-dirs dir)
    (spit (str file) (str (json/generate-string record) "\n") :append true)))

(defn record-provider-outage!
  "Throttled append: at most one line per role per min-interval-ms
   (invariant 2). role is the pane the observation came from (the observing
   role, not necessarily the only role attribution applies to on read - see
   evidence-for-provider); provider/text are what was observed; now-ms is
   the injected clock (never System/currentTimeMillis read here, so a
   wiring test can drive it deterministically). Never throws - a store the
   throttle check could not read degrades to \"no recent record\", which
   means this call proceeds to write rather than silently dropping evidence
   because of an unrelated read failure."
  ([state-dir role provider text now-ms]
   (record-provider-outage! state-dir role provider text now-ms default-observe-min-interval-ms))
  ([state-dir role provider text now-ms min-interval-ms]
   (try
     (let [last-ms (last-recorded-ms-for-role state-dir role)]
       (when (or (nil? last-ms) (>= (- now-ms last-ms) min-interval-ms))
         (append-line! state-dir {:ts (iso-of now-ms) :role role :provider provider :text text})
         true))
     (catch Exception _ false))))
