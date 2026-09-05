;; hardening_debt_ledger_lib.bb — pure decision core for BL-942's hardening
;; gate debt ledger. The office-hours mutation/CRAP bypass
;; (swarmforge/roles/hardender.prompt) defers a heavy gate on a busy host and
;; promises the full pass "still runs, just against a quiet host" - but
;; nothing recorded what was skipped, so no later pass could discharge it.
;; This is the RECORDING half only (the ticket's own scope): given a defer
;; event, produce a durable row; given the ledger, answer what is
;; outstanding. Choosing or building the drain (the remedy) is explicitly
;; out of scope here.
;;
;; Follows backlog/hotfix-ledger.yaml / hotfix_certification_lib.bb's own
;; shape (BL-848) rather than inventing a new storage idiom: a flat list of
;; scalar-field entries, hand-parsed line by line (no YAML library
;; dependency). `file_set` is the one non-scalar field; it is stored as a
;; single comma-joined line rather than a nested YAML list, keeping the
;; parser exactly as simple as the precedent's.

(ns hardening-debt-ledger-lib
  (:require [clojure.string :as str]))

;; ── file-set normalization (invariant 2: exact, order/dup independent) ─────

(defn normalize-file-set
  "Sorted, deduped, blank-stripped - two callers citing the same files in a
   different order or with accidental repeats name the same debt."
  [files]
  (vec (sort (distinct (remove str/blank? (map str/trim (or files [])))))))

(defn debt-key
  "The ledger's dedup identity (scenario 03): a defer for the SAME gate and
   SAME file set is the same debt, whichever parcel most recently reported
   it - re-recording it does not multiply the debt."
  [gate file-set]
  (str gate "::" (str/join "," (normalize-file-set file-set))))

;; ── parse/render (mirrors hotfix_certification_lib.bb's scalar-line idiom) ─

(def ^:private field->key
  {"parcel" :parcel "gate" :gate "file_set" :file-set
   "reason" :reason "load" :load "detected_at" :detected-at
   ;; BL-1439: a discharged row's own record of the run that paid the
   ;; debt - present only once discharged, absent (nil) on every row
   ;; before then, so the generic parse loop already picks these up with
   ;; no other change (unknown fields are ignored, known ones assoc'd).
   "discharged_at" :discharged-at "discharged_evidence" :discharged-evidence
   ;; BL-1439 amendment: an attempted-but-refused run's own record - same
   ;; absent-until-recorded shape as the discharge fields above.
   "attempted_at" :attempted-at "attempted_blocker" :attempted-blocker})

;; BL-942 architect bounce D1: reason/load are free-form prose (the "why" a
;; hardening pass deferred), and a naive first-"-scan for the closing quote
;; silently truncated at the FIRST embedded `"` with no error - "blocked by
;; the \"quiet host\" promise\" round-tripped to just "blocked by the ".
;; escape-quoted/unescape-quoted are single-pass character walks (never
;; sequential str/replace calls, which mis-round-trip once an escaped `\`
;; and an escaped `"` can appear adjacent to each other) so `\` -> `\\` and
;; `"` -> `\"` on the way out, and the exact reverse on the way in, compose
;; correctly for any input, not just the one reproduced case.
(defn- escape-quoted [s]
  (apply str (mapcat (fn [c] (case c \\ "\\\\" \" "\\\"" (str c))) (or s ""))))

(defn- unescape-quoted [s]
  (loop [cs (seq s) out []]
    (if (empty? cs)
      (apply str out)
      (let [c (first cs)]
        (if (and (= c \\) (seq (rest cs)))
          (recur (nnext cs) (conj out (second cs)))
          (recur (rest cs) (conj out c)))))))

(defn- find-closing-quote
  "Index of the closing (unescaped) double-quote in s (s[0] is the opening
   quote, search starts at 1). A \\\" pair never closes the string - skips
   the escaped character whole, so it can never land mid-escape-sequence."
  [s]
  (loop [i 1]
    (cond
      (>= i (count s)) nil
      (= (nth s i) \\) (recur (+ i 2))
      (= (nth s i) \") i
      :else (recur (inc i)))))

(defn- strip-inline-comment [s]
  (let [s (str/trim (or s ""))]
    (if (str/starts-with? s "\"")
      (let [end (find-closing-quote s)]
        (if end (subs s 0 (inc end)) s))
      (let [idx (str/index-of s " #")]
        (str/trim (if idx (subs s 0 idx) s))))))

(defn- unquote-str [s]
  (if (and (str/starts-with? s "\"") (str/ends-with? s "\"") (> (count s) 1))
    (unescape-quoted (subs s 1 (dec (count s))))
    s))

(defn- parse-scalar [raw]
  (let [v (unquote-str (strip-inline-comment raw))]
    (when-not (contains? #{"" "null" "~"} v) v)))

(defn parse-ledger
  "backlog/hardening-debt-ledger.yaml's text -> vector of row maps
   (kebab-case keys, :file-set already a vector). Tolerant of a leading
   header/comment block; unknown fields are ignored rather than failing the
   parse."
  [text]
  (loop [lines (str/split-lines (or text "")) rows [] current nil]
    (if (empty? lines)
      (vec (cond-> rows current (conj current)))
      (let [line (first lines)
            trimmed (str/trim line)]
        (cond
          (str/starts-with? line "- parcel:")
          (recur (rest lines)
                 (cond-> rows current (conj current))
                 {:parcel (parse-scalar (subs line (count "- parcel:")))})

          (nil? current)
          (recur (rest lines) rows current)

          (or (str/blank? trimmed) (str/starts-with? trimmed "#"))
          (recur (rest lines) rows current)

          :else
          (let [[_ field raw] (re-matches #"\s*([a-z_]+):(.*)" line)
                k (get field->key field)]
            (recur (rest lines) rows
                   (cond
                     (nil? k) current
                     (= k :file-set) (assoc current k (normalize-file-set (str/split (or (parse-scalar raw) "") #",")))
                     :else (assoc current k (parse-scalar raw))))))))))

(defn- render-row [{:keys [parcel gate file-set reason load detected-at
                           discharged-at discharged-evidence
                           attempted-at attempted-blocker]}]
  (str "- parcel: " parcel "\n"
       "  gate: " gate "\n"
       "  file_set: " (str/join "," (normalize-file-set file-set)) "\n"
       "  reason: \"" (escape-quoted reason) "\"\n"
       "  load: \"" (escape-quoted load) "\"\n"
       "  detected_at: " detected-at "\n"
       (if attempted-at (str "  attempted_at: " attempted-at "\n") "")
       (if attempted-blocker (str "  attempted_blocker: \"" (escape-quoted attempted-blocker) "\"\n") "")
       (if discharged-at (str "  discharged_at: " discharged-at "\n") "")
       (if discharged-evidence (str "  discharged_evidence: " discharged-evidence "\n") "")))

(def ledger-header
  (str "# backlog/hardening-debt-ledger.yaml — BL-942 hardening gate debt ledger.\n"
       "# One row per hardening pass that deferred a mutation or CRAP gate under\n"
       "# host load, recorded by hardening_debt_ledger_update.bb --defer. A gate that\n"
       "# RAN records no row (a ledger that fills on successes tells the operator\n"
       "# nothing). Deferring the same gate for the same file set again does not\n"
       "# duplicate the row (debt-key). Read back with hardening_debt_ledger_read.bb\n"
       "# — never by parsing a per-parcel evidence markdown file.\n\n"))

(defn render-ledger
  "vector of row maps -> backlog/hardening-debt-ledger.yaml's full text. Rows
   keep the order given (callers append as needed)."
  [rows]
  (str ledger-header (apply str (map render-row rows))))

;; ── pure decision core ──────────────────────────────────────────────────

(defn new-row [{:keys [parcel gate file-set reason load detected-at]}]
  {:parcel parcel :gate gate :file-set (normalize-file-set file-set)
   :reason reason :load load :detected-at detected-at})

(defn record-deferral
  "rows, defer-request -> updated rows. A no-op (rows returned unchanged,
   same value) when a row for this exact (gate, file-set) already exists —
   idempotent under redelivery, the same posture as the hotfix ledger
   (scenario 03)."
  [rows request]
  (let [row (new-row request)
        k (debt-key (:gate row) (:file-set row))]
    (if (some #(= k (debt-key (:gate %) (:file-set %))) rows)
      rows
      (conj rows row))))

(defn rows-for-parcel [rows parcel]
  (filterv #(= parcel (:parcel %)) rows))

(defn rows-for-file-set [rows file-set]
  (let [target (normalize-file-set file-set)]
    (filterv #(= target (:file-set %)) rows)))

;; ── BL-1439: discharge/attempt - the two ways a row learns a run happened ──
;; The row is never deleted (invariant 1): both verbs only ever ADD fields
;; to the matching row, so a deferral and what became of it stay readable
;; together in the same row. Both key on (parcel, gate) - the real ledger's
;; own identity today, since no two rows share that pair - via the SAME
;; find, so a future third verb (or a change to how a row is identified)
;; is one edit, not two kept in sync by hand.

(defn- find-row-idx [rows parcel gate]
  (first (keep-indexed (fn [i r] (when (and (= parcel (:parcel r)) (= gate (:gate r))) i)) rows)))

(defn discharge-debt
  "rows, {:parcel :gate :evidence :discharged-at} -> {:rows rows'
   :discharged? bool}. A discharge naming no matching row, or with no
   evidence path, changes nothing and answers :discharged? false so the
   caller refuses loudly rather than silently no-op'ing (the ticket's own
   invariant 1)."
  [rows {:keys [parcel gate evidence discharged-at]}]
  (if (str/blank? evidence)
    {:rows rows :discharged? false}
    (let [idx (find-row-idx rows parcel gate)]
      (if (nil? idx)
        {:rows rows :discharged? false}
        {:rows (update rows idx assoc :discharged-at discharged-at :discharged-evidence evidence)
         :discharged? true}))))

;; BL-1439 amendment 2026-09-06: a run the host refused (cooldown, load, a
;; suite-wide red blocking the dry run) is recorded as an ATTEMPT - never
;; discharged by assertion (invariant 3, carried from the original ticket).
;; Distinct from discharge-debt: the row gains :attempted-at/:attempted-
;; blocker but NEVER :discharged-at, so outstanding-debt (which filters on
;; :discharged-at alone) still reports it - an attempt is evidence a real
;; try happened, not proof the debt was paid.
(defn record-attempt
  "rows, {:parcel :gate :blocker :attempted-at} -> {:rows rows'
   :recorded? bool}. Refuses (rows unchanged) with no blocker text or no
   matching row - an attempt with no stated reason is exactly the silence
   invariant 3 forbids."
  [rows {:keys [parcel gate blocker attempted-at]}]
  (if (str/blank? blocker)
    {:rows rows :recorded? false}
    (let [idx (find-row-idx rows parcel gate)]
      (if (nil? idx)
        {:rows rows :recorded? false}
        {:rows (update rows idx assoc :attempted-at attempted-at :attempted-blocker blocker)
         :recorded? true}))))

(defn outstanding-debt
  "rows -> the machine-readable answer scenario 04 needs: every row's
   parcel/gate/file-set, no prose consulted to produce it. BL-1439: a
   discharged row (one with :discharged-at) contributes no outstanding
   debt and no register row/age - the ONE filter both the register CLI
   and the throttle read (invariant 2)."
  [rows]
  (->> rows
       (remove :discharged-at)
       (mapv #(select-keys % [:parcel :gate :file-set :reason :load :detected-at]))))

(defn has-row-for-parcel? [rows parcel]
  (boolean (seq (rows-for-parcel rows parcel))))

(defn distinct-file-set-row-count [rows file-set]
  (count (rows-for-file-set rows file-set)))
