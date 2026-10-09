;; BL-1851: pure core for a local-model seat's tuning report - grouping the
;; seat's requests by the settings in force when each ran (BL-1850's own
;; record) and by how Ollama served the model at that time
;; (local_seat_report_lib.bb's parse-ollama-loads, BL-1842), then
;; summarising each group's turn-level numbers and naming what differs
;; between consecutive groups. No IO here - the CLI reads every file and
;; hands this already-parsed data (BL-1811: the domain answer for "what do
;; the records say" lives in local_seat_report_lib.bb; this file's own
;; domain is "what does comparing them across groups say").
(ns local-seat-tuning-report-lib
  (:require [clojure.string :as str]))

(def unrecorded-settings "unrecorded settings")

;; ── settings / served lookups: "the latest row at or before" ─────────────

(defn settings-at-or-before
  "The settings-rows entry (BL-1850's own {:at :fingerprint ...} shape)
   with the latest :at that is <= iso-time, or nil when every row is
   later (the request ran before the first settings record - caller's
   own \"unrecorded settings\" branch, scenario 05)."
  [settings-rows iso-time]
  (->> settings-rows
       (filter #(<= (compare (:at %) iso-time) 0))
       (sort-by :at)
       last))

(defn served-at-or-before
  "The ollama-loads entry (local-seat-report-lib/parse-ollama-loads' own
   {:at-ms ...} shape) with the latest :at-ms that is <= epoch-ms, or nil
   when every load is later or there are none."
  [ollama-loads epoch-ms]
  (->> ollama-loads
       (filter #(<= (:at-ms %) epoch-ms))
       (sort-by :at-ms)
       last))

(defn served-label
  "\"N/M layers, KV KV\" for a parse-ollama-loads entry, or nil when
   served is nil or carries no layer facts (never a guessed default -
   the caller's own \"unknown serving\" branch). A load with layers but
   no recorded KV cache type prints \", unknown KV\" rather than
   dropping the KV part silently."
  [served]
  (when (and served (:layers-on-gpu served) (:layers-total served))
    (str (:layers-on-gpu served) "/" (:layers-total served) " layers, "
         (if (:kv-cache-type served)
           (str (:kv-cache-type served) " KV")
           "unknown KV"))))

;; ── grouping: consecutive requests under the same settings+served key ────

(defn epoch-ms
  "An ISO-8601 instant (Instant/parse shape, e.g. 2026-09-30T20:00:00Z) to
   epoch ms, or nil on any parse failure. Public: the CLI's own briefing
   window (BL-1854) and the lib's own group-key both need it."
  [iso]
  (try (.toEpochMilli (java.time.Instant/parse iso)) (catch Exception _ nil)))

(defn local-date-of
  "The host-local calendar date of an ISO instant, as \"YYYY-MM-DD\" -
   the briefing's own day rows are keyed by the host's local dates
   (BL-1854), never UTC."
  [iso]
  (try (str (java.time.LocalDate/ofInstant
            (java.time.Instant/parse iso)
            (java.time.ZoneId/systemDefault)))
       (catch Exception _ nil)))

(defn briefing-window
  "[start-ms end-ms] for a briefing of `days` days ending at `now` (an ISO
   instant): end is the host-local midnight of now's own local date (the
   window ends at the start of today, never mid-day), start is end minus
   days*86400000."
  [days now]
  (let [zone (java.time.ZoneId/systemDefault)
        end-ms (-> now
                   (java.time.Instant/parse)
                   (java.time.LocalDate/ofInstant zone)
                   ;; atTime is an INSTANCE method on LocalDate (returns a
                   ;; LocalDateTime) - LocalDateTime/atTime is not a static
                   ;; method and throws "No matching method atTime found
                   ;; taking 3 args" (confirmed empirically; the same
                   ;; failure the ticket's second salvage attempt hit).
                   (.atTime 0 0)
                   ;; LocalDateTime.toInstant(ZoneOffset) requires a FIXED
                   ;; offset, not a region-based zone like
                   ;; ZoneId/systemDefault's usual "Area/City" shape
                   ;; (confirmed empirically: ClassCastException, ZoneRegion
                   ;; cannot be cast to ZoneOffset) - .atZone first makes a
                   ;; ZonedDateTime, whose no-arg .toInstant needs no offset
                   ;; at all.
                   (.atZone zone)
                   (.toInstant)
                   (.toEpochMilli))]
    [(- end-ms (* days 86400000)) end-ms]))

(defn briefing-day-rows
  "requests/compressions/tool-calls (each carrying its own :timestamp)
   bucketed by the host-local date of their own timestamp: a map of
   local-date -> {:requests [...] :compressions [...] :tool-calls [...]},
   only dates that carry at least one event.

   Known bug, fixed here: a plain (merge m1 m2 m3) is SHALLOW - a date
   present in more than one bucket map keeps only the LAST map's value for
   that date, silently dropping the earlier kind's events for that day
   (confirmed empirically; the same failure the ticket's second salvage
   attempt hit, present here too). merge-with merge resolves a shared date
   key by merging the two INNER {:kind [...]} maps instead of replacing
   one with the other - each bucket's own map has exactly one kind key per
   date, so the inner merge never itself collides."
  [requests compressions tool-calls]
  (let [bucket (fn [kind rows]
                 (reduce (fn [acc row]
                           (let [d (local-date-of (:timestamp row))]
                             (if d
                               (update-in acc [d kind] conj row)
                               acc)))
                         {} rows))]
    (merge-with merge
                (bucket :requests requests)
                (bucket :compressions compressions)
                (bucket :tool-calls tool-calls))))

(defn- median [nums]
  (let [vs (sort (remove nil? nums))
        n (count vs)]
    (when (pos? n)
      (let [mid (quot n 2)]
        (if (odd? n)
          (nth vs mid)
          (/ (+ (nth vs (dec mid)) (nth vs mid)) 2.0))))))

(defn- per-request-metrics
  "Each request's own {:ttft-s :prefill-tps :decode-tps :output-tokens
   :thinking-share}, every key nil when its inputs are nil (never
   computed from a 0 the record never gave - the ticket's own FIRM
   invariant 2) rather than thrown on a missing field."
  [req]
  (let [{:keys [ttft-ms duration-ms input-tokens output-tokens thinking-tokens]} req
        ttft-s (when ttft-ms (/ ttft-ms 1000.0))
        decode-s (when (and duration-ms ttft-ms) (/ (- duration-ms ttft-ms) 1000.0))]
    {:ttft-s ttft-s
     :prefill-tps (when (and input-tokens ttft-s (pos? ttft-s)) (/ input-tokens ttft-s))
     :decode-tps (when (and output-tokens decode-s (pos? decode-s)) (/ output-tokens decode-s))
     :output-tokens output-tokens
     :thinking-share (when (and thinking-tokens output-tokens (pos? output-tokens))
                       (/ thinking-tokens (double output-tokens)))}))

(defn- round2 [n]
  (when n (/ (Math/round (* n 100.0)) 100.0)))

(defn- distinct-session-count [requests]
  (count (distinct (keep :session-id requests))))

(defn- most-failing-tool [failed-tool-calls]
  (when (seq failed-tool-calls)
    (->> failed-tool-calls
         (group-by :function-name)
         (sort-by (fn [[name calls]] [(- (count calls)) name]))
         first
         first)))

(defn summarise-events
  "The shared per-event summary core: the same metric keys summarise-group
   computes, from a day's (or a group's) own requests/compressions/
   tool-calls - every metric nil (never 0) when no event carries the field
   at all (the ticket's own FIRM invariant 2). summarise-group keeps its
   own :settings-fingerprint/:served keys on top of this."
  [requests compressions tool-calls]
  (let [failed (filter (complement :success?) tool-calls)
        metrics (map per-request-metrics requests)
        n-requests (count requests)
        savings (keep (fn [c] (when (and (:tokens-before c) (:tokens-after c))
                                 (- (:tokens-before c) (:tokens-after c))))
                      compressions)]
    {:sessions (distinct-session-count requests)
     :requests n-requests
     :median-ttft-s (round2 (median (map :ttft-s metrics)))
     :median-prefill-tps (round2 (median (map :prefill-tps metrics)))
     :median-decode-tps (round2 (median (map :decode-tps metrics)))
     :median-output-tokens (round2 (median (map :output-tokens metrics)))
     :median-thinking-share (round2 (median (map :thinking-share metrics)))
     :compressions (count compressions)
     :compressions-per-10-requests (when (pos? n-requests) (round2 (* 10.0 (/ (count compressions) n-requests))))
     :median-tokens-saved (round2 (median savings))
     :tool-calls (count tool-calls)
     :tool-call-failures (count failed)
     :tool-call-failure-rate (when (pos? (count tool-calls)) (round2 (* 100.0 (/ (count failed) (count tool-calls)))))
     :most-failing-tool (most-failing-tool failed)}))

(defn summarise-day
  "One day's own numbers: summarise-events over that day's own events,
   keyed by its local date."
  [{:keys [date requests compressions tool-calls]}]
  (assoc (summarise-events requests compressions tool-calls) :date date))

(defn settings-changes-in-window
  "The settings rows (BL-1850's own {:at :fingerprint ...} shape) whose own
   :at falls in [start-ms end-ms) - the briefing's own settings-change
   lines, one per row."
  [settings-rows start-ms end-ms]
  (->> settings-rows
       (keep (fn [row]
               (let [ms (epoch-ms (:at row))]
                 (when (and ms (<= start-ms ms) (< ms end-ms)) row))))
       (sort-by :at)
       vec))

(defn spilled-loads-in-window
  "The ollama-loads entries (local-seat-report-lib/parse-ollama-loads' own
   {:at-ms ...} shape) whose own :at-ms falls in [start-ms end-ms) AND
   which put layers outside VRAM (layers-on-gpu < layers-total) - the
   briefing's own spilled-load lines."
  [ollama-loads start-ms end-ms]
  (->> ollama-loads
       (keep (fn [load]
               (let [ms (:at-ms load)]
                 (when (and ms (<= start-ms ms) (< ms end-ms)
                            (:layers-on-gpu load) (:layers-total load)
                            (< (:layers-on-gpu load) (:layers-total load)))
                   load))))
       (sort-by :at-ms)
       vec))

(defn group-key
  "[fingerprint-or-unrecorded served-label-or-unknown] for timestamp iso -
   two timestamps under the SAME settings row and the SAME served load
   get the same key; either changing changes the key (the ticket's own
   \"within a fingerprint, it splits by how Ollama served\")."
  [settings-rows ollama-loads iso]
  (let [settings (settings-at-or-before settings-rows iso)
        ms (epoch-ms iso)
        served (when ms (served-at-or-before ollama-loads ms))]
    [(or (:fingerprint settings) unrecorded-settings)
     (or (served-label served) "unknown serving")]))

(defn- tag [kind events]
  (map #(assoc % :kind kind) events))

(defn partition-into-groups
  "requests/compressions/tool-calls (each carrying its own :timestamp) are
   merged into one timeline, sorted by timestamp, each tagged with the
   group-key in force at its own moment, then split into MAXIMAL
   consecutive runs of the same key (clojure.core/partition-by - a later
   return to an earlier key starts a NEW group, never rejoins the old
   one, matching \"a session is not the unit\": a session's own requests
   can span more than one group, and a group never reorders a session's
   requests back together once a settings row has split them).

   Returns a vector of {:key [...] :events [...]} in timestamp order,
   events still tagged :kind and carrying every original field."
  [{:keys [requests compressions tool-calls settings-rows ollama-loads]}]
  (let [all (sort-by :timestamp (concat (tag :request requests)
                                        (tag :compression compressions)
                                        (tag :tool-call tool-calls)))
        keyed (map #(assoc % :group-key (group-key settings-rows ollama-loads (:timestamp %))) all)]
    (->> (partition-by :group-key keyed)
         (mapv (fn [events] {:key (:group-key (first events)) :events (vec events)})))))

;; ── per-group summary: medians, rates, shares ─────────────────────────────

(defn summarise-group
  "One group's own numbers, every metric nil (never 0) when no event in
   the group carries the field at all - round2 keeps a median readable
   without fabricating false precision."
  [{:keys [key events]}]
  (let [requests (filter #(= :request (:kind %)) events)
        compressions (filter #(= :compression (:kind %)) events)
        tool-calls (filter #(= :tool-call (:kind %)) events)]
    (assoc (summarise-events requests compressions tool-calls)
           :settings-fingerprint (first key)
           :served (second key))))

;; ── difference between two consecutive groups' own settings/served ───────

(def ^:private labeled-settings-paths
  "Known settings leaf paths worth naming specially, with a human label
   and a unit suffix - the ticket's own named example (GPU power limit).
   Any other leaf that differs still reports, via the dotted-path
   fallback in settings-diff below - this table narrows the WORDING,
   never which differences are found."
  {[:gpu :powerLimitW] {:label "GPU power limit" :unit " W"}})

(defn- leaf-paths
  "Every [path value] pair at the leaves of x (maps and vectors walked).
   The TOP-LEVEL :at/:fingerprint are excluded by the caller (it passes a
   row already carrying them, but only ever compares the top level with
   them stripped) - this walk itself does no key-specific filtering."
  [x]
  (letfn [(walk [path v]
            (cond
              (map? v) (mapcat (fn [[k v2]] (walk (conj path k) v2)) v)
              (sequential? v) (mapcat (fn [i v2] (walk (conj path i) v2)) (range) v)
              :else [[path v]]))]
    (walk [] x)))

(defn fmt-number
  "A whole-number double (nvidia-smi's own powerLimitW, round2's own
   median output, ...) prints without a redundant .0 - 180, never 180.0,
   matching how a human reads a figure. Public: the CLI's own render
   uses this for every median/rate it prints, not only settings-diff's."
  [v]
  (if (and (double? v) (= v (double (long v))))
    (long v)
    v))

(defn settings-diff
  "Every leaf path whose value differs between two (possibly nil) settings
   rows, as \"<label> <old> -> <new>\" strings - a known path (the table
   above) gets its human label and unit; any other uses the dotted path
   itself, raw values. A path present on only one side is a difference
   too (old/new prints as \"unknown\" for the missing side)."
  [before after]
  (let [strip #(dissoc (or % {}) :at :fingerprint)
        before-map (into {} (leaf-paths (strip before)))
        after-map (into {} (leaf-paths (strip after)))
        paths (distinct (concat (keys before-map) (keys after-map)))]
    (vec (for [path paths
               :let [old (get before-map path ::missing)
                     new (get after-map path ::missing)]
               :when (not= old new)
               :let [{:keys [label unit]} (get labeled-settings-paths path
                                                {:label (str/join "." (map name path)) :unit ""})
                     fmt (fn [v] (if (= v ::missing) "unknown" (str (fmt-number v) unit)))]]
           (str label " " (fmt old) " -> " (fmt new))))))

(defn group-transition-diffs
  "The \"between consecutive groups\" lines for one boundary: a settings
   diff when the fingerprint changed, a one-line served change when the
   served label changed (independently - the ticket's own \"within a
   fingerprint, it splits by how Ollama served\" shows a group boundary
   that is a served-only change, never a settings one)."
  [prev-group next-group prev-settings-row next-settings-row]
  (let [[prev-fp prev-served] (:key prev-group)
        [next-fp next-served] (:key next-group)
        settings-lines (if (not= prev-fp next-fp)
                         (settings-diff prev-settings-row next-settings-row)
                         [])
        served-line (when (and (not= prev-served next-served) (= prev-fp next-fp))
                      [(str "served " prev-served " -> " next-served)])]
    (vec (concat settings-lines served-line))))
