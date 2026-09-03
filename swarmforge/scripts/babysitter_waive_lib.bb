;; babysitter_waive_lib.bb — BL-1344's pure read/decide core: the durable,
;; explicitly-recorded close-out a babysitter finding over PERMANENT history
;; needs, beside (never instead of) babysitterd_sweep_lib's rolling nudge
;; cooldown.
;;
;; The cooldown is right for a condition that will clear: space the reminder
;; out until it does. An Article 4.2 finding keys on a commit sha, and a
;; commit is forever, so the cooldown does not eventually stop that nudge -
;; it schedules it every 30 minutes for as long as the swarm runs. A channel
;; that cannot be closed is a channel that gets scrolled past, and Article
;; 4.2 findings are the ones that must not be.
;;
;; The three bounds, which are the whole design (BL-1344's invariants):
;;
;;   1. ONE KEY, ONE WAIVE. A waive names a single finding key and can
;;      suppress nothing else - not a class, not a pattern, not a later
;;      finding of the same kind over a different commit. A class-wide waive
;;      would hide the next real one.
;;   2. ONLY A RECORDED DECISION WAIVES. Nothing here can be produced by a
;;      sweep's own classification, however confident: every waive carries an
;;      author and a stated reason, and record-waive refuses without them.
;;      Same posture the hotfix ledger takes toward certification (BL-848).
;;   3. UNREADABLE MEANS NUDGE. Suppression requires a positively read waive.
;;      A store that is missing, unreadable or malformed suppresses nothing -
;;      the alert goes out. Failing quiet is the failure mode this whole
;;      ticket exists to prevent, so it must not be reachable through the
;;      mechanism that prevents it.
;;
;; Store schema (tracked YAML, so it survives a `.swarmforge/` wipe - the
;; same neighbourhood and the same shape as backlog/hotfix-ledger.yaml, the
;; precedent the ticket names), one block per waive:
;;
;;   - key: <finding key>
;;     waived_by: <who decided>
;;     reason: "<why this finding is legitimate or already remediated>"
;;     waived_at: <YYYY-MM-DD>

(ns babysitter-waive-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def waive-store-relative-path ["backlog" "babysitter-waives.yaml"])

(defn waive-store-path [project-root]
  (str (apply fs/path project-root waive-store-relative-path)))

;; ── parse / render ───────────────────────────────────────────────────────

(defn- unquote-str [s]
  (if (and (str/starts-with? s "\"") (str/ends-with? s "\"") (> (count s) 1))
    (subs s 1 (dec (count s)))
    s))

(defn- parse-scalar [raw]
  (let [v (unquote-str (str/trim (or raw "")))]
    (when-not (contains? #{"" "null" "~"} v) v)))

(def ^:private field->key
  {"key" :key "waived_by" :waived-by "reason" :reason "waived_at" :waived-at})

(defn- complete? [{:keys [key waived-by reason]}]
  (every? (comp seq str/trim str) [(or key "") (or waived-by "") (or reason "")]))

(defn parse-waives
  "The store's text -> {:ok? true :waives {finding-key -> waive}} or
   {:ok? false :reason <why>}.

   STRICT on purpose (invariant 3): a store that does not parse, or that
   holds an entry missing the fields that make a waive accountable, is NOT
   read as an empty store. An empty store IS readable - it simply waives
   nothing - but a broken one is an error the caller must alert on rather
   than treat as silence."
  [text]
  (loop [lines (str/split-lines (or text "")) waives {} current nil]
    (if (empty? lines)
      (let [entries (cond-> (vals waives) current (conj current))]
        (cond
          (some (complement complete?) entries)
          {:ok? false :reason :incomplete-entry}

          :else
          {:ok? true :waives (into {} (map (juxt :key identity)) entries)}))
      (let [line (first lines)
            trimmed (str/trim line)]
        (cond
          (str/starts-with? line "- key:")
          (recur (rest lines)
                 (cond-> waives current (assoc (:key current) current))
                 {:key (parse-scalar (subs line (count "- key:")))})

          (or (str/blank? trimmed) (str/starts-with? trimmed "#"))
          (recur (rest lines) waives current)

          ;; A line before the first entry, or one that is not a field of the
          ;; entry being read, means this is not a waive store: say so rather
          ;; than quietly honouring whatever did parse.
          :else
          (if-let [[_ field raw] (re-matches #"\s{2,}([a-z_]+):(.*)" line)]
            (if (and current (get field->key field))
              (recur (rest lines) waives (assoc current (get field->key field) (parse-scalar raw)))
              (recur (rest lines) waives current))
            {:ok? false :reason :unparseable}))))))

(defn- render-waive [{:keys [key waived-by reason waived-at]}]
  (str "- key: " key "\n"
       "  waived_by: " waived-by "\n"
       "  reason: \"" reason "\"\n"
       "  waived_at: " (or waived-at "null") "\n"))

(def store-header
  (str "# backlog/babysitter-waives.yaml - BL-1344 babysitter finding waives.\n"
       "# One entry per finding key an investigation closed out: the finding is\n"
       "# legitimate, or already remediated, and its nudge should stop. A waive\n"
       "# names ONE key and suppresses nothing else, and only a recorded decision\n"
       "# creates one - the sweep never waives anything on its own (BL-848's line).\n"
       "# Record one with babysitter_waive.bb --record; list them with --list.\n\n"))

(defn render-waives
  "{finding-key -> waive} -> the store's full text, keys in sorted order so a
   recorded waive produces a stable, reviewable diff."
  [waives]
  (str store-header (str/join "\n" (map render-waive (map waives (sort (keys waives)))))))

;; ── read ─────────────────────────────────────────────────────────────────

(defn read-waive-store
  "Reads the store at `path`. A MISSING store is not an error - there is
   simply nothing waived - but an unreadable one is: {:ok? false :reason
   :unreadable}. Everything else is parse-waives' verdict."
  [path]
  (cond
    (not (fs/exists? path)) {:ok? true :waives {}}
    :else (let [text (try (slurp (str path)) (catch Exception _ ::unreadable))]
            (if (= ::unreadable text)
              {:ok? false :reason :unreadable}
              (parse-waives text)))))

;; ── decide ───────────────────────────────────────────────────────────────

(defn partition-findings
  "findings + a read-waive-store/parse-waives result ->
   {:to-nudge [...] :suppressed [...] :store-error <reason or nil>}.

   Suppression requires a positively read waive for that exact key: when the
   store could not be read, EVERY finding stays in :to-nudge and the reason
   is surfaced as :store-error for the caller to report. A suppressed finding
   is returned, not discarded - it is still listed and still logged; what
   stops is the nudge."
  [findings read-result]
  (if (:ok? read-result)
    (let [waived? (fn [{:keys [key]}] (contains? (:waives read-result) key))]
      {:to-nudge (vec (remove waived? findings))
       :suppressed (vec (filter waived? findings))
       :store-error nil})
    {:to-nudge (vec findings)
     :suppressed []
     :store-error (or (:reason read-result) :unknown)}))

;; ── record ───────────────────────────────────────────────────────────────

(defn record-waive
  "Pure: existing waives + one new waive -> the new map. Refuses a waive
   without a key, an author or a stated reason - a waive nobody signed and
   nobody explained is exactly the silence invariant 2 forbids."
  [waives {:keys [key waived-by reason waived-at] :as waive}]
  (when-not (complete? waive)
    (throw (ex-info "a waive needs a key, a waiver and a reason"
                    {:key key :waived-by waived-by :reason reason})))
  (assoc waives (str/trim key)
         {:key (str/trim key)
          :waived-by (str/trim waived-by)
          :reason (str/trim reason)
          :waived-at waived-at}))

;; ── list ─────────────────────────────────────────────────────────────────

(defn format-waive-listing
  "One line per waive: the key, who waived it, when, and the reason they
   gave. A waive is an overlay on the record, never an erasure of it, so it
   must always be answerable to a reader."
  [waives]
  (mapv (fn [k]
          (let [{:keys [waived-by reason waived-at]} (get waives k)]
            (str k "\t" waived-by "\t" (or waived-at "unknown") "\t" reason)))
        (sort (keys waives))))
