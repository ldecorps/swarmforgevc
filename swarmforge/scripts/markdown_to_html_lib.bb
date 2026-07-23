;; BL-393 (cleaner extraction): a minimal, pure markdown->HTML renderer.
;; Split out of briefing_email_lib.bb, which owns briefing-specific email
;; concerns (subject, sent-state, optional sections, diagram embedding) -
;; markdown rendering is a generic, independently-testable concern with no
;; briefing-specific knowledge, so it gets its own narrow module, matching
;; this codebase's convention of one concern per _lib.bb file.
(ns markdown-to-html-lib
  (:require [clojure.string :as str]))

(defn- escape-html [s]
  (-> s
      (str/replace "&" "&amp;")
      (str/replace "<" "&lt;")
      (str/replace ">" "&gt;")))

(defn- render-inline-markdown [s]
  (str/replace s #"\*\*(.+?)\*\*" "<strong>$1</strong>"))

(defn- heading-line [line]
  (re-matches #"(#{1,6})\s+(.*)" line))

(defn- table-row-line? [line]
  (str/includes? line "|"))

(defn- table-separator-line? [line]
  (boolean (re-matches #"\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*" line)))

(defn- split-table-cells [line]
  (->> (-> line
           str/trim
           (str/replace #"^\|" "")
           (str/replace #"\|$" "")
           (str/split #"\|"))
       (map str/trim)
       vec))

(defn- render-table-cell [tag text]
  (str "<" tag ">" (render-inline-markdown (escape-html text)) "</" tag ">"))

(defn- render-table-row-html [cells tag]
  (str "<tr>" (str/join "" (map #(render-table-cell tag %) cells)) "</tr>"))

(defn- render-table-block [lines]
  (str "<table>"
       (render-table-row-html (split-table-cells (first lines)) "th")
       (str/join "" (map #(render-table-row-html (split-table-cells %) "td") (drop 2 lines)))
       "</table>"))

(defn render-markdown-to-html
  "Minimal pure markdown->HTML renderer: headings become <h1>-<h6>, a
   GFM-style pipe table becomes <table>/<tr>/<th|td>, and **bold** spans
   become <strong>. Every other non-blank line becomes its own <p>. Blank
   lines are separators only, never rendered. HTML-special characters are
   escaped before any markup is generated, so raw content can never inject
   stray markup into the output."
  [markdown]
  (loop [lines (str/split-lines (or markdown ""))
         out []]
    (if (empty? lines)
      (str/join "" out)
      (let [line (first lines)
            heading-match (heading-line line)]
        (cond
          (str/blank? line)
          (recur (rest lines) out)

          (and (table-row-line? line) (second lines) (table-separator-line? (second lines)))
          (let [table-lines (take-while table-row-line? lines)]
            (recur (drop (count table-lines) lines) (conj out (render-table-block table-lines))))

          heading-match
          (let [[_ hashes text] heading-match]
            (recur (rest lines)
                   (conj out (str "<h" (count hashes) ">" (render-inline-markdown (escape-html text)) "</h" (count hashes) ">"))))

          :else
          (recur (rest lines) (conj out (str "<p>" (render-inline-markdown (escape-html line)) "</p>"))))))))
