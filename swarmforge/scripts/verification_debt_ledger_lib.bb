;; verification_debt_ledger_lib.bb — pure decision core for BL-1782's
;; verification-debt ledger. A role that checks or classifies something
;; by hand, with no script to decide it, records one row here; a reader
;; counts a category's outstanding rows against a threshold and reports a
;; category at or over it with no open ticket declaring it as unowned.
;;
;; Mirrors hardening_debt_ledger_lib.bb's own shape (a flat list of
;; scalar-field rows, hand-parsed line by line, no YAML library
;; dependency) rather than inventing a new storage idiom.

(ns verification-debt-ledger-lib
  (:require [clojure.string :as str]))

;; ── field validation (recorder's own refusal rules) ──────────────────────

(def category-pattern #"^[a-z0-9]+(-[a-z0-9]+)*$")
(def ticket-pattern #"^(BL|GH)-\d+$")

(defn valid-category? [category]
  (boolean (and category (re-matches category-pattern category))))

(defn valid-ticket? [ticket]
  (boolean (and ticket (re-matches ticket-pattern ticket))))

(defn valid-description? [description]
  (not (str/blank? description)))

;; ── row identity (invariant 1: idempotent under redelivery) ─────────────

(defn row-key [category ticket]
  (str category "::" ticket))

;; ── parse/render (mirrors hardening_debt_ledger_lib.bb's scalar-line idiom,
;;    minus its file-set/discharge/attempt fields - none of that applies
;;    here in this slice) ──────────────────────────────────────────────────

(def ^:private field->key
  {"category" :category "ticket" :ticket "role" :role
   "description" :description "detected_at" :detected-at "evidence" :evidence})

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

(defn- find-closing-quote [s]
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
  "backlog/verification-debt-ledger.yaml's text -> vector of row maps.
   Tolerant of a leading header/comment block; unknown fields ignored."
  [text]
  (loop [lines (str/split-lines (or text "")) rows [] current nil]
    (if (empty? lines)
      (vec (cond-> rows current (conj current)))
      (let [line (first lines)
            trimmed (str/trim line)]
        (cond
          (str/starts-with? line "- category:")
          (recur (rest lines)
                 (cond-> rows current (conj current))
                 {:category (parse-scalar (subs line (count "- category:")))})

          (nil? current)
          (recur (rest lines) rows current)

          (or (str/blank? trimmed) (str/starts-with? trimmed "#"))
          (recur (rest lines) rows current)

          :else
          (let [[_ field raw] (re-matches #"\s*([a-z_]+):(.*)" line)
                k (get field->key field)]
            (recur (rest lines) rows
                   (if (nil? k) current (assoc current k (parse-scalar raw))))))))))

(defn- render-row [{:keys [category ticket role description detected-at evidence]}]
  (str "- category: " category "\n"
       "  ticket: " ticket "\n"
       "  role: " role "\n"
       "  description: \"" (escape-quoted description) "\"\n"
       "  detected_at: " detected-at "\n"
       (if evidence (str "  evidence: " evidence "\n") "")))

(def ledger-header
  (str "# backlog/verification-debt-ledger.yaml — BL-1782 verification-debt ledger.\n"
       "# One row per hand verification: a role checked or classified something\n"
       "# by hand because no script decides it yet. Written ONLY by\n"
       "# verification_debt_ledger_update.bb --record, committed by the recorder\n"
       "# itself - never hand-edited, never a parcel's own commit. Read back with\n"
       "# verification_debt_ledger_read.bb, never by parsing this file directly\n"
       "# (invariant 3).\n\n"))

(defn render-ledger [rows]
  (str ledger-header (apply str (map render-row rows))))

;; ── pure decision core ────────────────────────────────────────────────────

(defn record-verification
  "rows, request -> {:rows rows' :recorded? bool}. A no-op (rows returned
   unchanged, :recorded? false) when a row for this exact (category,
   ticket) already exists - idempotent under redelivery (invariant 1),
   whichever role most recently reported it."
  [rows {:keys [category ticket role description detected-at evidence]}]
  (let [k (row-key category ticket)]
    (if (some #(= k (row-key (:category %) (:ticket %))) rows)
      {:rows rows :recorded? false}
      {:rows (conj rows (cond-> {:category category :ticket ticket :role role
                                 :description description :detected-at detected-at}
                          evidence (assoc :evidence evidence)))
       :recorded? true})))

(defn rows-for-category [rows category]
  (filterv #(= category (:category %)) rows))

(defn outstanding-count
  "Every row counts as outstanding in this slice (BL-1783 adds settle)."
  [rows category]
  (count (rows-for-category rows category)))

(defn all-categories [rows]
  (vec (distinct (map :category rows))))

;; ── conf threshold (same `config <key> <value>` shape as the rest of
;;    swarmforge.conf - mutation_cooldown_lib.bb's own parse-conf, kept
;;    local here rather than a shared import so this lib stays a single,
;;    independently loadable file, same rationale as that lib's own) ─────

(defn parse-conf [content]
  (into {}
        (for [line (str/split-lines (or content ""))
              :let [line (str/trim line)]
              :when (str/starts-with? line "config ")
              :let [[_ k v] (re-matches #"config\s+(\S+)\s+(.*)" line)]
              :when k]
          [k (str/trim v)])))

(def default-threshold 3)

;; BL-1782 QA bounce D2: any parsed integer, including zero and negative,
;; used to pass straight through `or` (only nil/false are falsy in
;; Clojure) - a typo'd or blank-meaning-zero conf value threw every
;; category over threshold and unowned (a BL-1784 intake throttle on a
;; typo). standing_red_max_count's own parsePositiveInt already requires
;; a positive value with a default fallback; mirrored here.
(defn threshold [conf]
  (let [parsed (some-> (get conf "verification_debt_threshold") parse-long)]
    (if (and parsed (pos? parsed)) parsed default-threshold)))

;; BL-1782 QA bounce D1: the reader and the recorder each read
;; `<root>/swarmforge.conf`, a path nothing else in this codebase ever
;; writes to or reads from - swarmforge.conf always lives at
;; `<root>/swarmforge/swarmforge.conf` (mutation_cooldown_gate.bb,
;; swarm_identity_lib.bb's own default-swarmforge-conf-path). One shared
;; helper here, kept local (a plain string, no babashka.fs dependency)
;; rather than a cross-file require, for the same single-independently-
;; loadable-file rationale parse-conf above already established.
(defn default-conf-path [project-root]
  (str project-root "/swarmforge/swarmforge.conf"))

;; ── ownership: a top-level `verification_category:` line in an open
;;    ticket (backlog/paused or backlog/active), matched by exact id -
;;    prose never owns a category (invariant 2) ──────────────────────────

(defn- parse-category-field-value
  "The value half of a `verification_category: <value>` line - either a
   bare scalar id or a `[id1, id2]` flow list - to the set of ids it
   names. nil (names nothing) for a blank value."
  [raw]
  (let [v (str/trim (or raw ""))]
    (cond
      (str/blank? v) #{}
      (and (str/starts-with? v "[") (str/ends-with? v "]"))
      (into #{} (map str/trim (str/split (subs v 1 (dec (count v))) #",")))
      :else #{v})))

(defn declared-categories
  "The set of category ids a ticket file's own TEXT declares via a
   top-level (column-0) `verification_category:` line - never a nested
   or indented one, and never a `notes:`/prose mention (invariant 2)."
  [ticket-text]
  (reduce
   (fn [acc line]
     (if-let [[_ raw] (re-matches #"verification_category:(.*)" line)]
       (into acc (parse-category-field-value raw))
       acc))
   #{}
   (str/split-lines (or ticket-text ""))))
