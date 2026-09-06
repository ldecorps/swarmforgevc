#!/usr/bin/env bb
;; BL-1442: PROPERTY tests over briefing_email_lib.bb's bold-leading-ticket-ids
;; and render-briefing-html, covering the three invariants the ticket YAML
;; declares (coder-authored first, per BL-654). Seeded (not wall-clock)
;; randomness so failures reproduce: a fixed-seed java.util.Random, never
;; rand/rand-int's unseeded global generator. Follows the established .bb
;; property-runner precedent (bl942_hardening_debt_ledger_property_runner.bb).
;;
;; Generator reach and non-vacuity, the crux of not being tautological: each
;; generated case builds its OWN "which ticket ids should render bold" list
;; WHILE constructing the item text - the expectation comes from the
;; generator's bookkeeping, never from calling leading-label-bold-spans (or
;; any other function under test) a second time to produce it. A property
;; that called the function under test to compute its own expectation could
;; never fail no matter how broken the function became.
;;
;;   P1 render-only, source/plain-text untouched - invariant 1: builds a
;;      real temp briefings dir, drives send-unsent-briefings! through a
;;      fake send-email! adapter, and asserts the plain-text argument is
;;      byte-identical to what was written to disk (never gains ** or
;;      <strong>) and the file on disk is unchanged after the send.
;;   P2 every added <strong> is weight-only, no <style> block - invariant 2:
;;      every <strong> in the rendered html carries EXACTLY
;;      style="font-weight:600" (never a color, never any other style
;;      mixed in) and stripping every <style> block (mail clients drop
;;      them) leaves the html byte-identical, because there is none to
;;      strip.
;;   P3 stripping reproduces BL-1419's own rendering - invariant 3:
;;      stripping every <strong style="font-weight:600">ID</strong> this
;;      feature added back to bare ID text reproduces EXACTLY what
;;      style-inline-elements alone would have rendered for the same body
;;      html - same <li> count, no item split/reordered/reworded.
;;
;; Non-vacuity, verified by hand before landing (full account in
;; backlog/evidence/BL-1442-coder-pass-20260906.md):
;;
;;   - A REAL bug this generator caught on first run, before any deliberate
;;     break: label-symbol-re matched a bare "&", but escape-html
;;     (markdown_to_html_lib.bb) runs BEFORE bold-leading-ticket-ids ever
;;     sees the text, so a literal "&" from the source always arrives here
;;     as the 5-character entity "&amp;" - consuming only the leading "&"
;;     left "amp;..." unrecognized and truncated every "&"-joined label
;;     early (3 of 80 generated cases failed, e.g. "BL-2561 (skip BL-3352)
;;     & BL-6580 ..." bolded only BL-2561). Fixed by matching the whole
;;     entity; none of the eight manually-written Examples happened to use
;;     "&" as a connective, so this was invisible without the generator.
;;   - Deliberate break 1: label-aside-re narrowed to match only the
;;     opening "(" (never the balanced "(...)"") - 11/80 cases failed,
;;     each truncating its label right after the first id instead of
;;     skipping the aside's content wholesale.
;;   - Deliberate break 2: label-and-re changed to never match - 4/80
;;     cases failed, each "BL-A and BL-B" pair losing its second id.
;;
;; All three restored; this runner is green against the real
;; implementation.

(ns bl1442-briefing-bold-leading-ids-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "markdown_to_html_lib.bb")))

(def failures (atom []))
(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def ^:private rng (java.util.Random. 1442))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rchoice [coll] (nth coll (rint (count coll))))
(defn- rbool [] (.nextBoolean rng))

(def ^:private words ["fixes" "the" "gate" "reads" "clean" "orphans" "a" "merge" "sweep" "keeps" "landing" "cannot" "skip"])
(defn- rword [] (rchoice words))
(defn- rsentence [n] (str/join " " (repeatedly n rword)))

(defn- rticket-id []
  (str (rchoice ["BL" "GH"]) "-" (inc (rint 9999))))

;; Reach: an aside's own words sometimes include a ticket-id-shaped token
;; (the manual example's own shape - "BL-1401 (BL-632 acceptance
;; fixture)") - proving the parser skips an aside's content WHOLESALE,
;; never re-scanning it for ids to bold, whatever that content is.
(defn- raside-sentence [n]
  (let [ws (repeatedly n rword)
        ws (if (rbool) (concat ws [(rticket-id)]) ws)]
    (str/join " " ws)))

;; Builds ONE generated item's text and, independently, the ground-truth
;; list of ticket ids that should render bold - the generator's OWN
;; bookkeeping, never a call into the code under test.
(defn- gen-item []
  (if (rbool)
    ;; Does not open with a ticket id: random prose, sometimes with a
    ;; ticket id later in the sentence (must stay regular).
    (let [trailing-id? (rbool)
          text (str (rsentence (inc (rint 4)))
                     (when trailing-id? (str " " (rticket-id) " " (rsentence (inc (rint 3))))))]
      {:text text :expected-bold []})
    ;; Opens with a ticket id: 1-3 ids chained by "and"/"/"/","/"+"/"&",
    ;; each optionally followed by a parenthesised aside (whose own
    ;; content - including any ticket-id-shaped word inside it - is never
    ;; expected-bold).
    (let [n (inc (rint 3))
          connectives ["and" "/" "," "+" "&"]]
      (loop [i 0 label "" expected []]
        (if (= i n)
          (let [tail (str label ": " (rsentence (inc (rint 4)))
                           (when (rbool) (str " " (rticket-id))))] ; a stray id later, never expected-bold
            {:text tail :expected-bold expected})
          (let [id (rticket-id)
                aside? (rbool)
                sep (if (zero? i) "" (str (rchoice connectives) " "))
                label' (str label sep id (when aside? (str " (" (raside-sentence (inc (rint 2))) ")")))]
            (recur (inc i) (str label' (when (< (inc i) n) " ")) (conj expected id))))))))

(defn- render-item [item-text]
  (let [body-html (markdown-to-html-lib/render-markdown-to-html (str "- " item-text))]
    (briefing-email-lib/render-briefing-html "2026-09-05" body-html nil)))

(def NUM-RUNS 60)

;; ── P2 + P3: pure rendering properties, no fs/harness needed ────────────
(dotimes [n NUM-RUNS]
  (let [{:keys [text expected-bold]} (gen-item)
        body-html (markdown-to-html-lib/render-markdown-to-html (str "- " text))
        rendered (render-item text)
        li (first (re-seq #"<li[^>]*>.*?</li>" rendered))
        actual-bold (mapv second (re-seq #"<strong style=\"font-weight:600\">((?:BL|GH)-\d+)</strong>" (or li "")))]
    (assert= (str "P1/P3 case " n ": " (pr-str text) " - exactly the generator's own expected-bold ids render bold, in order")
             expected-bold
             actual-bold)
    ;; P2: every <strong> ANYWHERE in the rendered html (not just the
    ;; leading-label ones - a stray trailing id is never wrapped at all,
    ;; so this also proves nothing else in the sentence got bolded) is
    ;; weight-only.
    (doseq [[_ attrs] (re-seq #"<strong([^>]*)>" rendered)]
      (assert-true (str "P2 case " n ": every <strong> attrs is exactly style=\"font-weight:600\", got " (pr-str attrs))
                    (= attrs " style=\"font-weight:600\"")))
    (assert-true (str "P2 case " n ": no <style> block at all")
                  (not (str/includes? rendered "<style")))
    (assert= (str "P2 case " n ": stripping every <style> block leaves the html byte-identical (there is none to strip)")
             rendered
             (str/replace rendered #"<style[^>]*>.*?</style>" ""))
    ;; P3: stripping the added <strong> reproduces BL-1419's own rendering
    ;; (style-inline-elements alone), same <li> count.
    (let [before (briefing-email-lib/style-inline-elements body-html)
          after (briefing-email-lib/style-inline-elements (briefing-email-lib/bold-leading-ticket-ids body-html))
          stripped (str/replace after #"<strong style=\"font-weight:600\">((?:BL|GH)-\d+)</strong>" "$1")]
      (assert= (str "P3 case " n ": the <li> count is unchanged") (count (re-seq #"<li" before)) (count (re-seq #"<li" after)))
      (assert= (str "P3 case " n ": stripping the added <strong> reproduces BL-1419's own rendering exactly") before stripped))))

;; ── P1: the markdown source on disk and the plain-text part are never
;;    touched - driven through the REAL harness adapters (real fs, fake
;;    send-email!), not a direct call into render-briefing-html alone,
;;    because invariant 1 is about the WHOLE compose-and-send-one! path
;;    never rewriting the file or leaking a <strong>/** into the
;;    plain-text argument. ────────────────────────────────────────────────
(dotimes [n 20]
  (let [{:keys [text]} (gen-item)
        content (str "- " text "\n- an unrelated second item\n")
        dir (str (fs/create-temp-dir {:prefix "bl1442-prop-"}))
        file-name "2026-09-05.md"
        file-path (str (fs/path dir file-name))
        captured-text (atom nil)
        captured-html (atom nil)]
    (try
      (spit file-path content)
      (briefing-email-lib/send-unsent-briefings!
       dir
       {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
        :send-email! (fn [_subject text html & _]
                       (reset! captured-text text)
                       (reset! captured-html html)
                       {:success true})
        :log! (fn [& _] nil)})
      (assert= (str "P1 case " n ": the plain-text part is byte-identical to the composed markdown")
               content
               @captured-text)
      (assert-true (str "P1 case " n ": the plain-text part never gains ** or <strong>")
                    (and (not (str/includes? @captured-text "<strong"))
                         (= (str/index-of @captured-text "**") nil)))
      (assert= (str "P1 case " n ": the briefing file on disk is unchanged after the send")
               content
               (slurp file-path))
      (finally
        (fs/delete-tree dir)))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println (str "ALL PASS: bl1442_briefing_bold_leading_ids_property_runner.bb (" (+ NUM-RUNS 20) " cases)")))
