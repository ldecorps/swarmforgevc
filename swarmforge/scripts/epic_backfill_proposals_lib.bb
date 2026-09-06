;; BL-676: epic backfill over backlog/done/, slice 1 - a deterministic,
;; read-only proposal report. Reuses backlog_hygiene_lib.bb's own YAML field
;; readers and ticket-file enumeration rather than a second parser of either.
;;
;; Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "epic_backfill_proposals_lib.bb")))
;; Referred to as epic-backfill-proposals-lib/foo.
(ns epic-backfill-proposals-lib
  (:require [babashka.fs :as fs]
            [clojure.set :as set]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_hygiene_lib.bb")))

;; ── Pure: reading one ticket's own fields from its text ─────────────────

(defn ticket-fields
  "The subset of a ticket YAML's own fields this report reasons about,
   from its raw text - never a second YAML parser, just backlog-hygiene-
   lib's existing single-field and list-field readers."
  [text]
  {:id (backlog-hygiene-lib/field text "id")
   :type (backlog-hygiene-lib/field text "type")
   :epic (backlog-hygiene-lib/field text "epic")
   :milestone (backlog-hygiene-lib/field text "milestone")
   :title (backlog-hygiene-lib/field text "title")
   :decomposes-into (backlog-hygiene-lib/read-yaml-list-field text "decomposes_into")})

;; ── Pure: the live epic roster ────────────────────────────────────────────

(defn epic-roster
  "Every {:slug :title :milestone :decomposes-into} for backlog's own
   type: epic trackers, across every pool - an epic's own definition may
   itself already be in backlog/done/."
  [ticket-texts]
  (->> ticket-texts
       (map ticket-fields)
       (filter #(= "epic" (:type %)))
       (remove #(str/blank? (:epic %)))
       (map (fn [f] {:slug (:epic f) :title (:title f) :milestone (:milestone f)
                     :decomposes-into (:decomposes-into f)}))
       vec))

(defn- milestone-number [m]
  (when-let [[_ n] (re-matches #"M(\d+)" (or m ""))]
    (parse-long n)))

(defn clean-milestone-map
  "milestone -> epic slug, kept ONLY where exactly one roster epic declares
   that milestone - an ambiguous (shared) milestone maps to nothing, per
   the ticket's own 'never a forced fit' premise. Surfaced separately so
   the report's header can show the map the human is signing off on."
  [roster]
  (->> roster
       (remove #(str/blank? (:milestone %)))
       (group-by :milestone)
       (keep (fn [[milestone entries]]
               (when (= 1 (count entries))
                 [milestone (:slug (first entries))])))
       (into {})))

;; ── Pure: keyword tokenizing and roster matching ─────────────────────────
;; Live-repo spot-check (qa_e2e_procedure) caught a real precision defect:
;; matching a done ticket's title against an epic's own free-text TITLE
;; produced spurious matches on ordinary English prose words the title just
;; happens to contain - "Dead tile detection... when session disappears"
;; matched epic "bubble-thin-shell" on the word "when"; "show work items"
;; matched "stereo-router" on "work"; "append-only event log" matched
;; "github-auto-intake" on "only". None of those words appear in the
;; matched epic's own SLUG - a curated, compact, distinctive identifier -
;; only in its verbose title prose. Matching against slug tokens instead of
;; title tokens eliminated all three false positives (verified live): a
;; slug is deliberately chosen to be evocative of the epic's own domain,
;; where a title is free text that can contain almost anything.

(def ^:private stopwords #{"the" "and" "for" "with" "into" "from" "that" "this"
                            "epic" "its" "own" "one" "not" "are" "was" "were"
                            "when" "work" "only" "will" "then" "than" "have"
                            "has" "had" "who" "what" "why" "how" "now" "new"
                            "old" "use" "used" "using" "way" "get" "gets" "let"
                            "may" "can" "all" "any" "our" "out" "she" "his"
                            "her" "him" "you" "your" "per" "via"})

(defn- tokenize [s]
  (if (str/blank? s)
    #{}
    (->> (str/split (str/lower-case s) #"[^a-z0-9]+")
         (remove str/blank?)
         (remove #(< (count %) 4))
         (remove stopwords)
         set)))

(defn roster-match
  "The first roster epic this ticket's id or title matches, checked in
   order: (1) the ticket's own id appears in an epic's decomposes-into -
   an exact, stronger signal than any keyword overlap; (2) the ticket's
   title shares a keyword with the epic's own SLUG (never its free-text
   title - see the precision note above). {:epic :evidence} or nil - never
   a forced fit (invariant of the ticket's own premise, encoded here as the
   absence of a fallback branch)."
  [ticket-id ticket-title roster]
  (or (when-let [hit (first (filter #(some #{ticket-id} (:decomposes-into %)) roster))]
        {:epic (:slug hit) :evidence (str "listed in " (:slug hit) "'s decomposes_into")})
      (let [ticket-tokens (tokenize ticket-title)]
        (when (seq ticket-tokens)
          (some (fn [epic]
                  (let [epic-tokens (tokenize (str/replace (:slug epic) #"-" " "))
                        overlap (set/intersection ticket-tokens epic-tokens)]
                    (when (seq overlap)
                      {:epic (:slug epic) :evidence (str "slug keyword(s): " (str/join ", " (sort overlap)))})))
                roster)))))

(defn predates-earliest-epic?
  [ticket-milestone roster]
  (let [ticket-n (milestone-number ticket-milestone)
        epic-ns (keep (comp milestone-number :milestone) roster)]
    (boolean (and ticket-n (seq epic-ns) (< ticket-n (apply min epic-ns))))))

;; ── Pure: one done ticket -> one proposal row (or nil, already tagged) ───

(def sentinel-epic "pre-epic-era")

(defn propose-for-ticket
  "nil for an already-tagged ticket (excluded from the report entirely,
   scenario 05) - otherwise exactly one row, exactly one tier."
  [{:keys [id title milestone epic]} roster milestone-map]
  (cond
    (not (str/blank? epic)) nil

    (contains? milestone-map milestone)
    {:id id :tier "milestone-map" :proposal (get milestone-map milestone)
     :evidence (str "milestone " milestone)}

    :else
    (if-let [rm (roster-match id title roster)]
      {:id id :tier "roster-match" :proposal (:epic rm) :evidence (:evidence rm)}
      (if (predates-earliest-epic? milestone roster)
        {:id id :tier "pre-epic-era" :proposal sentinel-epic
         :evidence (str "milestone " milestone " predates the earliest roster epic's milestone")}
        {:id id :tier "needs-judgment" :proposal "" :evidence ""}))))

;; ── Pure: the report body ─────────────────────────────────────────────────

(defn build-rows
  "ticket-texts: EVERY ticket's raw text (every pool - the roster is drawn
   from all of it); done-ticket-texts: just the backlog/done/ subset this
   report proposes over. One row per untagged done ticket, id-sorted for a
   stable diff."
  [ticket-texts done-ticket-texts]
  (let [roster (epic-roster ticket-texts)
        milestone-map (clean-milestone-map roster)]
    (->> done-ticket-texts
         (map ticket-fields)
         (keep #(propose-for-ticket % roster milestone-map))
         (sort-by :id)
         vec)))

(defn render-report
  "Pure: rows -> the report's full markdown text. No filesystem, no
   wall-clock content (BL-676's own determinism constraint) - the report's
   own bytes are a pure function of the rows."
  [rows]
  (str "# Epic backfill proposals (BL-676)\n\n"
       "Deterministic, read-only proposal report. One row per `backlog/done/` "
       "ticket with a missing or empty `epic:` field. `needs-judgment` rows "
       "carry an empty proposal for a human to fill; nothing here is applied "
       "automatically (BL-677 is the apply slice, gated on this report being "
       "human-approved).\n\n"
       "| id | tier | proposal | evidence |\n"
       "| --- | --- | --- | --- |\n"
       (str/join "\n" (map (fn [{:keys [id tier proposal evidence]}]
                              (str "| " id " | " tier " | " proposal " | " evidence " |"))
                            rows))
       "\n"))

;; ── IO: the one write ─────────────────────────────────────────────────────

(defn report-path [project-root]
  (str (fs/path project-root "backlog" "evidence" "BL-676-epic-backfill-proposals-report.md")))

(defn generate-report!
  "The whole slice, IO edges named: reads every ticket file, writes EXACTLY
   the one report file. Never touches any other path - the invariant."
  [project-root]
  (let [backlog-root (str (fs/path project-root "backlog"))
        all-files (backlog-hygiene-lib/list-backlog-ticket-files backlog-root)
        ;; fs/path preserves a "./" prefix (project-root "." -> "./backlog"),
        ;; but fs/glob's own returned strings do not carry one - a naive
        ;; string-prefix (or even fs/starts-with?, which is Path-textual, not
        ;; normalized) comparison between the two silently matches nothing.
        ;; fs/normalize collapses the "./" first, on BOTH sides, before the
        ;; ancestry check - proven live: this returned zero done-files (and
        ;; zero report rows) against the real repo with project-root ".".
        done-dir (str (fs/normalize (fs/path backlog-root "done")))
        done-files (filter #(fs/starts-with? (fs/normalize %) done-dir) all-files)
        read! (fn [f] (slurp (str f)))
        rows (build-rows (map read! all-files) (map read! done-files))
        report (render-report rows)]
    (fs/create-dirs (fs/parent (report-path project-root)))
    (spit (report-path project-root) report)
    {:rows (count rows) :path (report-path project-root)}))
