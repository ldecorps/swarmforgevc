#!/usr/bin/env bb
;; Pure backlog epic/milestone hygiene checks for open tickets.
;; Used by backlog_epic_milestone_audit.bb and specifier_backlog_hygiene_gate.sh.

(ns backlog-hygiene-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "acceptance_pointer_gate_lib.bb")))

(defn field [text name]
  (when-let [[_ v] (re-find (re-pattern (str "(?m)^" name ":\\s*(.*)$")) text)]
    (let [v (-> v str/trim (str/replace #"^\"|\"$" "") (str/replace #"^'|'$" ""))]
      (when-not (str/blank? v) v))))

(defn- acceptance-line-tail-and-body
  "[tail body-lines] for the ticket's `acceptance:` line - tail is that
   line's own trailing text (mirrors pre_qa_gate_gather_lib.bb's
   read-yaml-field, which is what the pre-QA gates actually see), and
   body-lines is every immediately-following blank-or-indented line (a
   would-be block-scalar body), stopping at the first top-level
   (non-indented, non-blank) line. nil when there is no acceptance: line."
  [text]
  (let [lines (str/split-lines text)
        idx (first (keep-indexed (fn [i l] (when (re-matches #"^acceptance:.*$" l) i)) lines))]
    (when idx
      [(str/trim (str/replace (nth lines idx) #"^acceptance:\s*" ""))
       (->> (drop (inc idx) lines)
            (take-while #(or (str/blank? %) (re-matches #"^\s+.*$" %))))])))

(defn unreadable-acceptance-violation
  "BL-922: a block-scalar acceptance: (bare `|`/`>` + optional chomping,
   the SAME residue acceptance-pointer-gate-lib's pre-QA gates see once the
   body is stripped away) whose indented body names a real, single
   specs/features/*.feature path is caught HERE, at mint/hygiene-gate time,
   instead of five stages later at the documenter->QA hop. A block scalar
   naming no feature file (an honest not-yet-drafted placeholder) is never
   reported - that is BL-626's business, not this gate's (invariant 3). A
   glob-shaped mention (`specs/features/BL-555-*.feature`, prose describing
   a file the specifier has not yet named) is likewise never a real
   pointer - `*` is excluded from the path charset, not just whitespace,
   or 'not yet written' placeholders that happen to preview their own
   eventual filename would be misreported as already-armed (measured
   against the live backlog: BL-555, BL-588)."
  [text {:keys [id path]}]
  (when-let [[tail body] (acceptance-line-tail-and-body text)]
    (when (acceptance-pointer-gate-lib/block-scalar-residue? tail)
      (when-let [feature-path (some #(re-find #"specs/features/[^\s*]+\.feature\b" %) body)]
        {:kind :unreadable-acceptance :id id :path path :feature-path feature-path}))))

(defn violations-for-text [text {:keys [id path]}]
  (let [id (or id (field text "id") path)
        typ (or (field text "type") "")
        epic (field text "epic")
        ms (field text "milestone")
        out (atom [])]
    (if (= typ "epic")
      (do
        (when-not epic
          (swap! out conj {:kind :missing-epic-on-epic :id id :path path}))
        (when-not ms
          (swap! out conj {:kind :missing-milestone :id id :path path})))
      (when-not epic
        (swap! out conj {:kind :missing-epic :id id :path path})))
    (when-let [v (unreadable-acceptance-violation text {:id id :path path})]
      (swap! out conj v))
    @out))

(defn violations-for-file [f]
  (let [text (slurp (str f))
        id (or (field text "id") (last (str/split (str f) #"/")))]
    (violations-for-text text {:id id :path (str f)})))

(defn format-violation [{:keys [kind id path feature-path]}]
  (case kind
    :missing-epic (str "MISSING-EPIC " id "  " path "  (non-epic ticket needs epic:)")
    :missing-epic-on-epic (str "MISSING-EPIC " id "  " path "  (type: epic must self-declare epic:)")
    :missing-milestone (str "MISSING-MILESTONE " id "  " path "  (type: epic needs milestone:)")
    :unreadable-acceptance (str "UNREADABLE-ACCEPTANCE " id "  " path "  (acceptance: is a block"
                                 " scalar hiding " feature-path " - rewrite as a single-line pointer)")
    (str "VIOLATION " id "  " path)))

(defn all-clean? [violations] (empty? violations))
