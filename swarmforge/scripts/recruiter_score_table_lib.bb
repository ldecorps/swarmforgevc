;; recruiter_score_table_lib.bb — BL-1822: the pure rendering core for the
;; morning briefing's Model scout section, over the recruiter's own
;; score-table.json (BL-1821). No fs, no clock read, no git here - the CLI
;; (recruiter_score_table_cli.bb) is the thin I/O wrapper: it reads the
;; table file and lists docs/briefings/, resolves `today`, and calls
;; `render-model-scout-section` with the pure facts.

(ns recruiter-score-table-lib
  (:require [clojure.string :as str]))

(def no-table-line
  "Model scout: no scout has run yet.")

(def stale-table-line
  "Model scout: no new scout since the previous briefing.")

(defn- row-line
  "One rendered row: the model (bold, the 2026-09-06 scan-weight rule in
   docs/design/system.md - QA bounce D1, BL-1822), its passed/total count,
   and the incumbent flag when set - the three facts the ticket's own
   outline names, in that order. Never re-derives or re-ranks anything the
   table did not already say."
  [row]
  (str "- **" (get row "model") "** — " (get row "passed") "/" (get row "total")
       (when (get row "incumbent") " (incumbent)")))

(defn- scout-date
  "The YYYY-MM-DD date label of a score table's `updated_at` timestamp
   (recruiter_specifier_scout.sh's own compact `date -u +%Y%m%dT%H%M%SZ`
   stamp, e.g. \"20261001T043200Z\") - nil when the field is absent or too
   short to hold a date at all, so a malformed/missing timestamp fails
   CLOSED to \"treat as not fresh\" (never a crash, never a false fresh)."
  [table]
  (let [stamp (get table "updated_at")]
    (when (and stamp (>= (count stamp) 8))
      (str (subs stamp 0 4) "-" (subs stamp 4 6) "-" (subs stamp 6 8)))))

(defn- fresh-since?
  "True when `table` was updated strictly after `previous-briefing-date`
   (a \"YYYY-MM-DD\" string, or nil when no earlier briefing exists yet -
   in which case there is nothing to be stale relative to, so any table at
   all counts as fresh). Lexical string comparison is valid date-ordering
   for this fixed-width ISO shape."
  [table previous-briefing-date]
  (or (nil? previous-briefing-date)
      (when-let [scouted (scout-date table)]
        (pos? (compare scouted previous-briefing-date)))))

(defn render-model-scout-section
  "`table`: the score table's parsed JSON (string keys), or nil when no
   score-table.json exists yet. `previous-briefing-date`: the latest
   docs/briefings/<date>.md label strictly before today, or nil.

   Three outcomes, matching the ticket's own outline exactly:
     - no table at all: `no-table-line`.
     - a table that is not fresh since the previous briefing:
       `stale-table-line`.
     - a fresh table: every row, highest `passed` first, then the table's
       own `recommend.specifier` line - the recommend text is the
       recruiter's own sentence, never re-composed here."
  [table previous-briefing-date]
  (cond
    (nil? table)
    no-table-line

    (not (fresh-since? table previous-briefing-date))
    stale-table-line

    :else
    (let [rows (sort-by #(get % "passed") > (get table "rows" []))
          recommend (get-in table ["recommend" "specifier"] "no recommendation")]
      (str/join "\n"
                (concat ["Model scout:"]
                        (map row-line rows)
                        [(str "Recommend: " recommend)])))))

(defn previous-briefing-date
  "The latest YYYY-MM-DD label `briefing-date-label-fn` extracts from
   `filenames` (docs/briefings/'s own entries) that sorts STRICTLY before
   `today` - never today's own just-written briefing, which would make a
   scout run earlier today read as stale against itself. nil when no
   qualifying file exists (first-ever run, or every briefing on disk is
   today's or later - e.g. a clock skew fixture). `briefing-date-label-fn`
   is injected (the CLI passes the real
   briefing-email-lib/briefing-date-label) so this file holds no second
   copy of that filename pattern."
  [filenames today briefing-date-label-fn]
  (->> filenames
       (keep briefing-date-label-fn)
       (filter #(neg? (compare % today)))
       sort
       last))
