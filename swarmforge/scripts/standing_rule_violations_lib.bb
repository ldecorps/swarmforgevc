;; BL-337: "a rule that nobody measures is a rule that silently stops
;; holding" - counts violations of ANY standing engineering rule, derived
;; ENTIRELY from history already committed to this repo, never a new
;; counter. This project's own constitution articles and role prompts
;; already self-document their violation history: every time a rule bites
;; again, whoever catches it appends a parenthetical citing the ticket that
;; found it - e.g. "(Confirmed 5x across BL-250/BL-252/BL-253 in one
;; session.)", "(3rd occurrence. BL-272... BL-296/297/298...)". That
;; citation trail IS the durable violation log this ticket asks for; this
;; module only parses it.
;;
;; Pure text parsing only - no filesystem, no git, no clock. The impure
;; file-reading adapter lives in the caller (handoffd.bb's briefing wiring,
;; standing_rule_violations_cli.bb).
(ns standing-rule-violations-lib
  (:require [clojure.string :as str]))

;; A rule's own PROVENANCE citation ("(source: <file>, BL-NNN)" - crediting
;; which ticket BUILT a tool/mechanism the rule text describes) is not a
;; violation record and must never be counted as one. This is the one
;; textual pattern in this codebase that reliably distinguishes the two
;; (confirmed: architect.prompt's co-change-report citation, BL-255, is
;; exactly this shape) - stripped before citation-scanning runs.
(defn strip-source-citations [text]
  (str/replace text #"\(source:[^)]*\)" ""))

;; A top-level rule marker is either a dash bullet ("- ...", the majority
;; convention across the constitution articles) or a numbered list item
;; ("1. ...", used by local-engineering.prompt's own Architecture Rules
;; section) - both are this project's own established rule-authoring
;; styles, so both must be recognized for "a rule added tomorrow needs no
;; code change" to actually hold regardless of which list style its
;; section uses.
(def ^:private rule-marker-pattern #"^(- |\d+\. ).*")

(defn- boundary-line? [line]
  (boolean (or (re-matches rule-marker-pattern line) (re-matches #"^#.*" line))))

;; Splits one file's raw text into "rule" blocks: each top-level bullet or
;; numbered item, spanning its own wrapped continuation lines up to the
;; NEXT top-level marker or markdown heading. A rule added tomorrow needs
;; no code change here - it is just another marker this same scan already
;; covers.
(defn parse-rule-blocks [content]
  (let [lines (vec (str/split-lines (or content "")))
        n (count lines)
        starts (keep-indexed (fn [i l] (when (re-matches rule-marker-pattern l) i)) lines)
        block-end (fn [start]
                    (loop [i (inc start)]
                      (if (or (>= i n) (boundary-line? (nth lines i))) i (recur (inc i)))))]
    (vec (for [s starts]
           (str/join "\n" (subvec lines s (block-end s)))))))

;; The distinct BL-NNN tickets cited within one rule block, provenance
;; citations excluded, sorted NUMERICALLY ascending. Ticket IDs in this
;; project are assigned sequentially as tickets are created, so numeric
;; order is a reliable proxy for chronological order regardless of the
;; order they happen to be listed in the rule's own prose.
(defn citations-in-block [block]
  (->> (strip-source-citations block)
       (re-seq #"BL-\d+")
       distinct
       (sort-by #(Long/parseLong (subs % 3)))
       vec))

;; standing-rule-violation-observable-02: "violations that predate the
;; rule are not counted against it." The numerically-SMALLEST cited ticket
;; is the origin incident that PROMPTED writing the rule in the first
;; place - it necessarily predates the rule's own existence, so it is
;; never itself a violation OF the rule. Every citation with a LARGER
;; ticket number happened chronologically later (ticket IDs increase with
;; creation time), i.e. after the rule already existed - a genuine
;; violation. `citations` is assumed already sorted ascending (see
;; citations-in-block above).
(defn violation-citations [citations]
  (vec (rest citations)))

;; A short, human-readable label for a rule block: its first line, bullet
;; marker and markdown emphasis stripped, truncated so a briefing line
;; stays scannable.
(defn rule-summary [block]
  (let [first-line (-> (first (str/split-lines block))
                        (str/replace #"^(- |\d+\. )" "")
                        (str/replace #"\*\*" ""))]
    (if (> (count first-line) 90) (str (subs first-line 0 87) "...") first-line)))

;; standing-rule-violation-observable-05: EVERY rule block is returned,
;; even one with zero violations since landing (a rule with only its own
;; origin citation, or no citation at all, is reported as holding -
;; :count 0 - never silently omitted, which would be indistinguishable
;; from "this rule was never even scanned").
(defn scan-file-violations [path content]
  (mapv (fn [block]
          (let [citations (citations-in-block block)
                violations (violation-citations citations)]
            {:file path :rule (rule-summary block) :citations violations :count (count violations)}))
        (parse-rule-blocks content)))

;; Given every scanned constitution/role-prompt file's {:path :content},
;; the full rule list across the whole project, most-violated first (a
;; stable secondary sort by file+rule keeps the order deterministic for
;; equal counts, so the briefing line never flaps run to run with no
;; underlying change).
(defn scan-violations [files]
  (->> files
       (mapcat (fn [{:keys [path content]}] (scan-file-violations path content)))
       (sort-by (juxt (comp - :count) :file :rule))
       vec))

;; How many DISTINCT standing rules record this ticket as a violation
;; SINCE THEY LANDED (i.e. this ticket appears in the rule's own
;; violation-citations, never merely as its origin) - the direct answer to
;; "how many times was <ticket> violated": a ticket that broke more than
;; one rule at once is counted once per rule it broke, never merged into a
;; single ambiguous total.
(defn citing-rules-for-ticket [violations ticket-id]
  (vec (filter #(some #{ticket-id} (:citations %)) violations)))

(defn total-citation-count [violations]
  (reduce + 0 (map :count violations)))
