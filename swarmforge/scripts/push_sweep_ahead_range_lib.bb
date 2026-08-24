;; push_sweep_ahead_range_lib.bb (BL-1085) — shared ahead-range gather + refusal cache.
;;
;; push-sweep's QA and noop-merge gates each used to walk origin/main..main
;; independently every heavy cycle. This lib:
;;   1. Walks the ahead range at most once per tick (tick memo).
;;   2. Replays a previously COMPLETE gather when the cache key is unchanged
;;      (main tip SHA + ordered ahead-SHA vector). Incomplete gathers are
;;      never stored — a fail-closed hole must not freeze as a verdict.
;;
;; The cache REPLAYS a verdict a full enumeration already produced for the
;; same input. It never INFERS one from tip properties alone (BL-952).
;;
;; Loaded via load-file; refer as push-sweep-ahead-range-lib/foo.

(ns push-sweep-ahead-range-lib)

(defn cache-key
  "Key material: tip SHA plus the ordered ahead-SHA set (vector)."
  [main-tip ahead-shas]
  {:main-tip main-tip :ahead-shas (vec ahead-shas)})

(defn cache-hit?
  "True only when a prior COMPLETE gather matches this exact key."
  [cache-entry key]
  (boolean
   (and (map? cache-entry)
        (:complete? cache-entry)
        (= key (:key cache-entry))
        (map? (:payload cache-entry)))))

(defn next-cache-entry
  "Store only complete payloads. Incomplete clears the cache entirely so a
   later tick with the same tip/ahead set cannot replay a stale refusal."
  [key payload]
  (if (:complete? payload)
    {:key key :complete? true :payload (dissoc payload :enumerated?)}
    nil))

(defn begin-tick!
  "Drop the per-tick memo so a new push-sweep! starts clean. Does not touch
   the cross-tick refusal cache."
  [tick-memo-atom]
  (reset! tick-memo-atom nil))

(defn- store-tick-memo! [tick-memo-atom payload]
  (reset! tick-memo-atom payload)
  payload)

(defn- incomplete-no-walk-payload
  []
  {:complete? false :enumerated? false
   :qa-facts {:facts-complete? false}
   :noop-facts {:facts-complete? false}
   :ahead-shas nil :main-tip nil})

(defn- replay-cached [cache-entry tick-memo-atom]
  (let [payload (assoc (:payload cache-entry) :enumerated? false)]
    (store-tick-memo! tick-memo-atom payload)))

(defn- gather-and-maybe-cache! [deps key]
  (let [{:keys [enumerate! cache-atom tick-memo-atom]} deps
        payload (assoc (enumerate! key) :enumerated? true)
        entry (next-cache-entry key payload)]
    (reset! cache-atom entry)
    (store-tick-memo! tick-memo-atom payload)))

(defn- resolve-fresh! [deps key]
  (let [cached @(:cache-atom deps)]
    (if (cache-hit? cached key)
      (replay-cached cached (:tick-memo-atom deps))
      (gather-and-maybe-cache! deps key))))

(defn resolve-ahead-range-facts!
  "Single chokepoint for ahead-range facts.

   deps:
     :cache-atom      (atom nil | cache-entry)
     :tick-memo-atom  (atom nil | payload) — shared within one push-sweep tick
     :read-key!       () -> cache-key map, or nil when tip/ahead cannot be read
     :enumerate!      (key) -> {:complete? bool :qa-facts map :noop-facts map
                                :ahead-shas vector :main-tip string}

   Returns the payload. On read-key failure returns an incomplete payload
   with :enumerated? false (no walk was possible)."
  [{:keys [tick-memo-atom read-key!] :as deps}]
  (if-let [memo @tick-memo-atom]
    memo
    (if-let [key (read-key!)]
      (resolve-fresh! deps key)
      (store-tick-memo! tick-memo-atom (incomplete-no-walk-payload)))))