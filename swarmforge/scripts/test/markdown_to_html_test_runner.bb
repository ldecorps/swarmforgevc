#!/usr/bin/env bb
;; TDD runner for markdown_to_html_lib.bb (BL-393 cleaner extraction) -
;; pure assertions only, no fs/network fixtures needed.
(ns markdown-to-html-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "markdown_to_html_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── render-markdown-to-html (pure, BL-393) ───────────────────────────────

(assert= "body-html-02: a heading renders as an HTML heading element"
         "<h2>Section</h2>"
         (markdown-to-html-lib/render-markdown-to-html "## Section"))

(assert= "body-html-02: a level-1 heading renders as h1"
         "<h1>Title</h1>"
         (markdown-to-html-lib/render-markdown-to-html "# Title"))

(assert= "body-html-02: bold text renders as HTML emphasis"
         "<p>This is <strong>bold</strong> text.</p>"
         (markdown-to-html-lib/render-markdown-to-html "This is **bold** text."))

(assert= "body-html-02: a markdown table renders as HTML table markup"
         (str "<table><tr><th>A</th><th>B</th></tr>"
              "<tr><td>1</td><td>2</td></tr></table>")
         (markdown-to-html-lib/render-markdown-to-html "| A | B |\n| --- | --- |\n| 1 | 2 |"))

(assert= "body-html-01: plain text renders as its own paragraph"
         "<p>Hello world</p>"
         (markdown-to-html-lib/render-markdown-to-html "Hello world"))

(assert= "render-markdown-to-html: blank lines separate paragraphs but are never rendered themselves"
         "<p>One</p><p>Two</p>"
         (markdown-to-html-lib/render-markdown-to-html "One\n\n\nTwo"))

(assert= "render-markdown-to-html: nil input renders to an empty string, never a crash"
         ""
         (markdown-to-html-lib/render-markdown-to-html nil))

(assert= "render-markdown-to-html: HTML-special characters are escaped so raw markup can't leak through"
         "<p>a &lt;script&gt; &amp; more</p>"
         (markdown-to-html-lib/render-markdown-to-html "a <script> & more"))

(assert= "body-html-03: heading, paragraph, and a later appended section all render, not only the lede"
         "<h2>Lede</h2><p>Intro.</p><h2>Appended section</h2><p>Detail.</p>"
         (markdown-to-html-lib/render-markdown-to-html "## Lede\n\nIntro.\n\n## Appended section\n\nDetail."))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str (count @failures) " FAILED"))
    (System/exit 1))
  (println "ALL PASS: markdown_to_html_lib.bb"))
