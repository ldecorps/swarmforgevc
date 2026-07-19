;; BL-515: pure detector for the vendored APS gherkin-parser's silent
;; wrapped-step-line drop. The parser (swarmforge/vendor/aps/, PINNED -
;; engineering.prompt forbids modifying/reimplementing it) silently
;; discards a step's second physical line - and any <param> on it - while
;; still reporting a clean parse (exit 0). Standard Gherkin steps are
;; single-line; this helper makes OUR gate reject the wrap instead of
;; teaching the parser multi-line steps.
;;
;; Two independent signatures, both load-bearing:
;;   1. find-continuation-line-findings - scans the RAW feature text (the
;;      parser never sees the dropped line, so only the source text can
;;      catch it) for a bare non-blank line inside a Scenario/Scenario
;;      Outline/Background body that is not a step keyword line, a table
;;      row, a tag, a comment, a docstring delimiter/content, or a section
;;      header.
;;   2. find-phantom-column-findings - reads the parser's own JSON IR
;;      (already parsed into a map with keyword keys) and flags an
;;      Examples column referenced by no step parameter - the param-loss
;;      signature this same bug also produces, and independently the
;;      specifier's existing prune-unreferenced-columns rule.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "gherkin_lint_gate_lib.bb")))
;; and referred to as gherkin-lint-gate-lib/foo.

(ns gherkin-lint-gate-lib
  (:require [clojure.string :as str]))

(def ^:private step-keyword-re
  #"(?i)^\s*(Given|When|Then|And|But)\b|^\s*\*(\s|$)")

(def ^:private body-opening-header-re
  #"(?i)^\s*(Scenario Outline|Scenario|Background)\s*:")

(def ^:private section-header-re
  #"(?i)^\s*(Feature|Background|Scenario Outline|Scenario|Examples|Rule)\s*:")

(def ^:private tag-line-re #"^\s*@\S+")
(def ^:private comment-line-re #"^\s*#")
(def ^:private table-row-re #"^\s*\|")
(def ^:private docstring-delim-re #"^\s*(\"\"\"|```)")

(defn find-continuation-line-findings
  "Scans raw feature text for a bare continuation line inside a
   Scenario/Scenario Outline/Background body - the shape of a wrapped step
   whose second line the vendored parser silently drops. Returns a seq of
   {:line <1-based line number> :text <trimmed line text>}, in file order."
  [feature-text]
  (loop [lines (str/split-lines (or feature-text ""))
         line-no 1
         in-body? false
         in-docstring? false
         findings []]
    (if (empty? lines)
      findings
      (let [line (first lines)
            trimmed (str/trim line)]
        (cond
          (str/blank? line)
          (recur (rest lines) (inc line-no) in-body? in-docstring? findings)

          (re-find docstring-delim-re line)
          (recur (rest lines) (inc line-no) in-body? (not in-docstring?) findings)

          in-docstring?
          (recur (rest lines) (inc line-no) in-body? in-docstring? findings)

          (re-find body-opening-header-re line)
          (recur (rest lines) (inc line-no) true in-docstring? findings)

          (re-find section-header-re line)
          (recur (rest lines) (inc line-no) false in-docstring? findings)

          (not in-body?)
          (recur (rest lines) (inc line-no) in-body? in-docstring? findings)

          (or (re-find step-keyword-re line)
              (re-find tag-line-re line)
              (re-find comment-line-re line)
              (re-find table-row-re line))
          (recur (rest lines) (inc line-no) in-body? in-docstring? findings)

          :else
          (recur (rest lines) (inc line-no) in-body? in-docstring?
                 (conj findings {:line line-no :text trimmed})))))))

(def ^:private param-token-re
  ;; BL-259 (specs/pipeline/runtime.js `substitute`): an Examples column
  ;; name may legitimately contain spaces or hyphens ("forbidden edge",
  ;; "work-dir-form") - the runtime matches ANY non-angle-bracket text
  ;; between < and >, not just [A-Za-z0-9_]+. The vendored parser's own
  ;; :parameters IR field uses a narrower extraction that silently omits
  ;; those names, so it is NOT the source of truth for "is this column
  ;; referenced" - only step TEXT, read the same way runtime.js reads it,
  ;; is. (A column whose <token> was on a dropped continuation line is
  ;; correctly still unreferenced: the token is textually absent from the
  ;; truncated text the parser kept.)
  #"<([^<>]+)>")

(defn- referenced-param-names
  [step]
  (->> (re-seq param-token-re (:text step))
       (map second)
       set))

(defn- all-referenced-param-names
  [background steps]
  (reduce into #{} (map referenced-param-names (concat background steps))))

(defn- scenario-phantom-columns
  [background scenario]
  (let [examples (:examples scenario)
        columns (when (seq examples) (set (map name (keys (first examples)))))
        referenced (all-referenced-param-names background (:steps scenario))]
    (when (seq columns)
      (for [col (sort columns)
            :when (not (contains? referenced col))]
        {:scenario (:name scenario) :column col}))))

(defn find-phantom-column-findings
  "Reads the parser's own JSON IR (already parsed into a map, keyword
   keys) and flags any Scenario Outline Examples column referenced by no
   <token> in its own steps' or the feature's Background steps' text (a
   Background step is substituted against the same Examples row - see
   specs/pipeline/runtime.js's scenarioSteps). Returns a seq of {:scenario
   <name> :column <name>}, in scenario-then-sorted-column order."
  [parsed-ir]
  (let [background (:background parsed-ir)]
    (mapcat (partial scenario-phantom-columns background) (:scenarios parsed-ir))))

(defn lint-findings
  "Combined findings for a feature file: {:continuation-lines [...]
   :phantom-columns [...]}. Both empty means the gate should pass. BL-520
   drained the grandfathered wrap allowlist, so continuation-line findings
   are never suppressed."
  [feature-text parsed-ir]
  {:continuation-lines (find-continuation-line-findings feature-text)
   :phantom-columns (find-phantom-column-findings parsed-ir)})

(defn clean?
  [findings]
  (and (empty? (:continuation-lines findings))
       (empty? (:phantom-columns findings))))
