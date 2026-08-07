;; hotfix_certification_lib.bb — pure decision core for BL-848's hotfix
;; certification ledger + recurrent check. Snapshot in, findings out — no
;; git, no fs, no clock, exactly the babysitterd_sweep_lib.bb posture. The
;; impure wiring (reading backlog/hotfix-ledger.yaml, scanning `main`,
;; resolving a stamp ticket's folder/human_approval, sending the coordinator
;; note) lives in operator_runtime.bb's hotfix-certification-sweep!.
;;
;; Detection is DECLARED, not inferred (R1): a commit is a hotfix only when
;; its message carries a `Hotfix-Certification:` trailer. Every derived
;; predicate the specifier measured over 600 commits of main failed on a
;; real hotfix (see BL-848's ticket body) — the derived scan here (scenario
;; 07/08, unaccounted-commits) ships anyway, honestly scoped as a review
;; queue with known false negatives, never a certification verdict.
;;
;; State machine (R2): pending (no stamp ticket) -> stamp-open (ticket in
;; flight) -> awaiting-human (ticket reached done, still human_approval:
;; pending) -> certified | waived. Only a recorded ledger `human-decision`
;; (approved|waived) — a fact this lib only ever READS, never derives or
;; writes — resolves the last transition (invariant 3, scenario 06).

(ns hotfix-certification-lib
  (:require [clojure.string :as str]))

;; ── ledger parse/render ──────────────────────────────────────────────────────
;; Committed schema (backlog/hotfix-ledger.yaml), one block per entry:
;;   - commit: <10-hex>
;;     subject: "<commit subject>"
;;     detected_at: <YYYY-MM-DD>
;;     state: pending|stamp-open|awaiting-human|certified|waived
;;     stamp_ticket: <BL-nnn> | null
;;     human_decision: null | approved | waived
;;     decided_at: <YYYY-MM-DD> | null
;; `state` is fully derivable (decide-entry-state) and is rewritten by the
;; sweep as a live snapshot; `stamp_ticket` and `human_decision`/`decided_at`
;; are the two durable, non-derivable facts (R2) — the sweep only ever
;; APPENDS a new pending entry (scenario 01) or refreshes `state`; it never
;; writes stamp_ticket/human_decision/decided_at (that is hotfix_ledger_
;; update.bb's job, run by a human/operator).

(def ^:private field->key
  {"commit" :commit "subject" :subject "detected_at" :detected-at
   "state" :state "stamp_ticket" :stamp-ticket "human_decision" :human-decision
   "decided_at" :decided-at})

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
  "backlog/hotfix-ledger.yaml's text -> vector of entry maps (kebab-case
   keys). Tolerant of a leading header/comment block and per-field trailing
   `# comment`s; unknown fields are ignored rather than failing the parse."
  [text]
  (loop [lines (str/split-lines (or text "")) entries [] current nil]
    (if (empty? lines)
      (vec (cond-> entries current (conj current)))
      (let [line (first lines)
            trimmed (str/trim line)]
        (cond
          (str/starts-with? line "- commit:")
          (recur (rest lines)
                 (cond-> entries current (conj current))
                 {:commit (parse-scalar (subs line (count "- commit:")))})

          (nil? current)
          (recur (rest lines) entries current)

          (or (str/blank? trimmed) (str/starts-with? trimmed "#"))
          (recur (rest lines) entries current)

          :else
          (let [[_ field raw] (re-matches #"\s*([a-z_]+):(.*)" line)
                k (get field->key field)]
            (recur (rest lines) entries (if k (assoc current k (parse-scalar raw)) current))))))))

(defn- render-entry [{:keys [commit subject detected-at state stamp-ticket human-decision decided-at]}]
  (str "- commit: " commit "\n"
       "  subject: \"" subject "\"\n"
       "  detected_at: " detected-at "\n"
       "  state: " state "\n"
       "  stamp_ticket: " (or stamp-ticket "null") "\n"
       "  human_decision: " (or human-decision "null") "\n"
       "  decided_at: " (or decided-at "null") "\n"))

(def ledger-header
  (str "# backlog/hotfix-ledger.yaml — BL-848 hotfix certification ledger.\n"
       "# One entry per commit that DECLARES itself a hotfix (Hotfix-Certification:\n"
       "# trailer) or that a human has recorded a certification decision for.\n"
       "# `state` is a derived snapshot, refreshed by operator_runtime's recurrent\n"
       "# check; `stamp_ticket`/`human_decision`/`decided_at` are durable facts set\n"
       "# only by a human/operator (see hotfix_ledger_update.bb, never by the sweep).\n"
       "# docs/how-to/BL-848-certify-an-operator-hotfix.md documents the workflow.\n\n"))

(defn render-ledger
  "vector of entry maps -> backlog/hotfix-ledger.yaml's full text. Entries
   keep the order given (callers sort/append as needed)."
  [entries]
  (str ledger-header (apply str (map render-entry entries))))

;; ── pure decision core (state machine, R2/scenarios 01-06) ──────────────────

(defn decide-entry-state
  "entry: {:stamp-ticket :human-decision :stamp-ticket-status :stamp-ticket-human-approval}.
   Returns {:state :action (:mint-stamp-ticket | :report-anomaly | nil) :open? bool}.
   `human-decision` (approved|waived) is a fact this fn only ever reads — it
   is never derived from stamp-ticket-human-approval, which is a DIFFERENT
   field (the ticket's ordinary promotion-authorization flag, not a
   certification decision). That separation is invariant 3, mechanically:
   the only way this fn ever returns certified/waived is a non-nil
   human-decision already present in its input."
  [{:keys [stamp-ticket human-decision stamp-ticket-status stamp-ticket-human-approval]}]
  (cond
    (= human-decision "approved") {:state "certified" :action nil :open? false}
    (= human-decision "waived") {:state "waived" :action nil :open? false}
    (nil? stamp-ticket) {:state "pending" :action :mint-stamp-ticket :open? true}
    (not= stamp-ticket-status "done") {:state "stamp-open" :action nil :open? true}
    (= stamp-ticket-human-approval "pending") {:state "awaiting-human" :action nil :open? true}
    :else {:state "awaiting-human" :action :report-anomaly :open? true}))

;; ── declared-hotfix / unaccounted-commit detection (R1, scenarios 07/08) ────

(defn hotfix-trailer-value
  "The `Hotfix-Certification:` trailer's value from a commit message, or nil
   when absent. Trailer lines are matched at any indentation, trimmed."
  [message]
  (some (fn [line]
          (let [t (str/trim line)]
            (when (str/starts-with? t "Hotfix-Certification:")
              (str/trim (subs t (count "Hotfix-Certification:"))))))
        (str/split-lines (or message ""))))

(defn hotfix-declared? [message] (boolean (hotfix-trailer-value message)))

(defn cited-ticket-ids
  "Every BL-nnn/GH-n id named anywhere in a commit message — the same
   tested-but-honest 'names a ticket id' signal R1 measured (1 hit / 600,
   misses both known hotfixes on its own, hence never used alone here)."
  [message]
  (set (re-seq #"\b(?:BL|GH)-\d+\b" (or message ""))))

(def ^:private non-functional-path-re #"^docs/|^backlog/|\.md$")

(defn functional-path? [path] (not (re-find non-functional-path-re (str path))))

(defn functional-commit? [files] (boolean (some functional-path? (or files []))))

(defn unaccounted-commit?
  "c: {:functional? :hotfix-declared? :in-ledger? :cited-ticket-done?}. A
   review-queue candidate only — 'names a ticket that reached done' is the
   SAME predicate R1 showed FALSELY CERTIFIES f9cf29c2 (cites BL-811 only as
   a posture reference), so a positive here is honestly a maybe, not proof
   of pipeline coverage. Callers must report it as such (unaccounted-report-
   line does)."
  [{:keys [functional? hotfix-declared? in-ledger? cited-ticket-done?]}]
  (boolean (and functional? (not hotfix-declared?) (not in-ledger?) (not cited-ticket-done?))))

(defn new-entry
  "A freshly-detected declared hotfix, ready to append to the ledger
   (scenario 01) — uncertified from the moment it enters."
  [{:keys [commit subject detected-at]}]
  {:commit commit :subject subject :detected-at detected-at
   :state "pending" :stamp-ticket nil :human-decision nil :decided-at nil})

;; ── resurfacing (dedup + cooldown, scenario 02 — mirrors babysitterd_sweep_
;;    lib.bb's own decide-nudges: an open finding is never permanently muted,
;;    only cooldown-throttled) ──────────────────────────────────────────────

(def default-resurface-cooldown-ms
  "6h, matching BL-848's HOTFIX_CERT_RESURFACE_MS default."
  (* 6 60 60 1000))

;; ── single pure entry point ──────────────────────────────────────────────────

(defn assemble-report
  "snapshot:
     :entries               ledger entries, each merged with the caller-
                             resolved :stamp-ticket-status/:stamp-ticket-
                             human-approval facts
     :now-ms
     :last-surfaced-ms-by-commit  {commit -> epoch-ms of last surfacing}
     :resurface-cooldown-ms (default default-resurface-cooldown-ms)
     :main-commits           recent commits on main, each pre-enriched by the
                             caller with :commit :subject :message :functional?
                             :hotfix-declared? :cited-ticket-done?
   Returns {:decided :due-for-surfacing :mint-requests :anomalies
            :new-ledger-entries :unaccounted :new-dedup-state}."
  [{:keys [entries now-ms last-surfaced-ms-by-commit resurface-cooldown-ms main-commits]
    :or {last-surfaced-ms-by-commit {} resurface-cooldown-ms default-resurface-cooldown-ms}}]
  (let [known-commits (set (map :commit entries))
        decided (mapv (fn [e] (merge e (decide-entry-state e))) entries)
        due? (fn [{:keys [commit]}]
               (let [last-ms (get last-surfaced-ms-by-commit commit)]
                 (or (nil? last-ms) (>= (- (long now-ms) (long last-ms)) (long resurface-cooldown-ms)))))
        due (vec (filter #(and (:open? %) (due? %)) decided))
        mint-requests (vec (filter #(= :mint-stamp-ticket (:action %)) due))
        anomalies (vec (filter #(= :report-anomaly (:action %)) decided))
        new-ledger-entries (vec (for [c (or main-commits []) :when (and (:hotfix-declared? c) (not (known-commits (:commit c))))]
                                   (new-entry c)))
        unaccounted (vec (for [c (or main-commits [])
                                :when (unaccounted-commit? (assoc c :in-ledger? (boolean (known-commits (:commit c)))))]
                            c))]
    {:decided decided
     :due-for-surfacing due
     :mint-requests mint-requests
     :anomalies anomalies
     :new-ledger-entries new-ledger-entries
     :unaccounted unaccounted
     :new-dedup-state (reduce (fn [m {:keys [commit]}] (assoc m commit now-ms))
                               (or last-surfaced-ms-by-commit {})
                               due)}))

;; ── formatting ────────────────────────────────────────────────────────────

(def ^:private note-max-length 80)

(defn- clip [s] (if (<= (count s) note-max-length) s (subs s 0 note-max-length)))

(defn mint-nudge-message [{:keys [commit]}]
  (clip (str "hotfix " commit " has no stamp ticket - mint a review ticket for it")))

(defn surfaced-log-line
  "No embedded timestamp/tag - the caller's own log! already stamps and tags
   every line (see operator_runtime.bb's other sweeps)."
  [{:keys [commit state]}]
  (str "[" commit "] state=" state))

(defn anomaly-log-line [{:keys [commit stamp-ticket stamp-ticket-human-approval]}]
  (str "[" commit "] stamp ticket " stamp-ticket
       " reached done with human_approval=" (pr-str stamp-ticket-human-approval)
       " (expected pending or a recorded ledger decision) - check wiring"))

(defn unaccounted-report-line [{:keys [commit subject]}]
  (str "[" commit "] " subject
       " - unaccounted for (review queue only, known false negatives, not a certification verdict)"))
