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
   "reason" :reason "load" :load "detected_at" :detected-at})

(defn- strip-inline-comment [s]
  (let [s (str/trim (or s ""))]
    (if (str/starts-with? s "\"")
      (let [end (str/index-of s "\"" 1)]
        (if end (subs s 0 (inc end)) s))
      (let [idx (str/index-of s " #")]
        (str/trim (if idx (subs s 0 idx) s))))))

(defn- unquote-str [s]
  (if (and (str/starts-with? s "\"") (str/ends-with? s "\"") (> (count s) 1))
    (subs s 1 (dec (count s)))
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

(defn- render-row [{:keys [parcel gate file-set reason load detected-at]}]
  (str "- parcel: " parcel "\n"
       "  gate: " gate "\n"
       "  file_set: " (str/join "," (normalize-file-set file-set)) "\n"
       "  reason: \"" reason "\"\n"
       "  load: \"" load "\"\n"
       "  detected_at: " detected-at "\n"))

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

(defn outstanding-debt
  "rows -> the machine-readable answer scenario 04 needs: every row's
   parcel/gate/file-set, no prose consulted to produce it."
  [rows]
  (mapv #(select-keys % [:parcel :gate :file-set :reason :load :detected-at]) rows))

(defn has-row-for-parcel? [rows parcel]
  (boolean (seq (rows-for-parcel rows parcel))))

(defn distinct-file-set-row-count [rows file-set]
  (count (rows-for-file-set rows file-set)))
