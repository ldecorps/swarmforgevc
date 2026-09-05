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
  (-> s
      (str/replace #"\*\*(.+?)\*\*" "<strong>$1</strong>")
      (str/replace #"`([^`]+?)`" "<code>$1</code>")))

(defn- heading-line [line]
  (re-matches #"(#{1,6})\s+(.*)" line))

(defn- table-row-line? [line]
  (str/includes? line "|"))

;; BL-1419: block-starter predicates, so a run of consecutive non-blank
;; lines can be told apart from a run belonging to a DIFFERENT block type -
;; a "- " list line or "> " quote line ends whatever paragraph run came
;; before it, rather than being swallowed into it.
(defn- list-item-line? [line]
  (str/starts-with? line "- "))

(defn- blockquote-line? [line]
  (str/starts-with? line "> "))

;; A list item's WRAPPED continuation: indented (leading whitespace),
;; non-blank, and not itself the start of a new list item - joins onto the
;; PRECEDING <li> rather than starting its own.
(defn- list-continuation-line? [line]
  (and (not (str/blank? line))
       (not (list-item-line? line))
       (re-matches #"\s+.*" line)))

;; A line that continues whatever paragraph is already open: non-blank and
;; not the start of any OTHER block type (heading/table/list/quote).
(defn- paragraph-continuation-line? [line]
  (and (not (str/blank? line))
       (not (heading-line line))
       (not (table-row-line? line))
       (not (list-item-line? line))
       (not (blockquote-line? line))))

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

;; BL-1419: a list item's own text plus every wrapped continuation line
;; that follows it, joined with single spaces - "- " strips its own marker
;; (2 chars), a continuation line is only ever trimmed (its indentation is
;; not markup).
(defn- render-list-block [list-lines]
  (let [items (reduce
                (fn [acc l]
                  (if (list-item-line? l)
                    (conj acc (subs l 2))
                    (conj (pop acc) (str (peek acc) " " (str/trim l)))))
                []
                list-lines)]
    (str "<ul>" (str/join "" (map #(str "<li>" (render-inline-markdown (escape-html %)) "</li>") items)) "</ul>")))

(defn render-markdown-to-html
  "Block-aware markdown->HTML renderer (BL-1419): headings become <h1>-<h6>,
   a GFM-style pipe table becomes <table>/<tr>/<th|td>, a run of consecutive
   \"- \" lines (with their indented wrapped continuation lines) becomes one
   <ul> of <li>, a run of consecutive \"> \" lines becomes one <blockquote>,
   and every other run of consecutive non-blank lines is one <p> - each
   block's lines join with single spaces where the wraps were, so a
   **bold** span or sentence that wrapped across lines renders as one
   unbroken element instead of one per source line (BL-393's own per-line
   contract, kept only for the blank-line-separator rule). backtick spans
   become <code>, **bold** spans become <strong>. Blank lines are
   separators only, never rendered. HTML-special characters are escaped
   before any markup is generated, so raw content can never inject stray
   markup into the output."
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

          (blockquote-line? line)
          (let [block-lines (take-while blockquote-line? lines)
                joined (str/join " " (map #(str/trim (subs % 2)) block-lines))]
            (recur (drop (count block-lines) lines)
                   (conj out (str "<blockquote>" (render-inline-markdown (escape-html joined)) "</blockquote>"))))

          (list-item-line? line)
          (let [list-lines (take-while #(or (list-item-line? %) (list-continuation-line? %)) lines)]
            (recur (drop (count list-lines) lines) (conj out (render-list-block list-lines))))

          :else
          (let [block-lines (take-while paragraph-continuation-line? lines)
                joined (str/join " " (map str/trim block-lines))]
            (recur (drop (count block-lines) lines)
                   (conj out (str "<p>" (render-inline-markdown (escape-html joined)) "</p>")))))))))
