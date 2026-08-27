#!/usr/bin/env bb
;; BL-821 coder pass (BL-654 Invariants): PROPERTY test over
;; briefing_email_lib.bb's briefing-in-window?/partition-by-window encoding
;; the ticket's second declared invariant:
;;
;;   "No ordinary sweep path ever emails a briefing dated outside the
;;    allowed window, whatever the marker contains; only an explicit
;;    one-shot operator action can."
;;
;; The marker-contents half of that claim is structural, not this
;; function's concern - find-unsent-briefings already filters by the
;; marker BEFORE partition-by-window ever sees the list, so a briefing the
;; marker already excludes never reaches the window check either way. What
;; THIS property owns is the window decision itself: for ANY file name and
;; ANY today-str, in-window?/suppressed? is definite (never throws), and
;; agrees exactly with a reference definition of the window re-derived
;; independently below - so a future edit to briefing-in-window? that
;; silently widens/narrows/shifts the window, or reintroduces a crash on a
;; malformed input, is caught here even though every fixed example in the
;; acceptance feature and the example-based unit tests still passes.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none).
;; No test.check equivalent is wired for .bb scripts (BL-472), so this is a
;; hand-rolled generator in the actual enforced gate for .bb code
;; (swarmforge/scripts/test/) - same gap bl902's own property runner notes.
;;
;; Non-vacuity proven by hand at authoring time: temporarily changed
;; briefing-window-days from 2 to 1 and reran this file - P1 (agreement
;; with the reference window) failed on every generated "yesterday" case
;; (the reference still says in-window, the mutated code said out) exactly
;; as expected, then the value was restored and all properties passed
;; again. Separately, temporarily made briefing-date-label match a
;; suffixed name (dropping the exact-match `re-matches` for a looser
;; `re-find`) and reran - P1 failed on the suffixed-name generated cases
;; (reference says "no date label -> out of window", mutated code
;; extracted a date and said in-window), then the fix was restored.

(ns bl821-briefing-window-property-runner
  (:require [babashka.fs :as fs])
  (:import [java.time LocalDate]
           [java.time.temporal ChronoUnit]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(zero? i) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (try (pred-fn input) (catch Exception e (str "threw: " (.getMessage e))))]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── generator: a today-str anchor, plus a briefing file name that is
;; either a well-formed date offset from it (in a wide range spanning well
;; inside and well outside the 2-day window), a suffixed name, or garbage. ─

;; A modest, fixed pool of anchor dates - the offset (below) is what varies
;; the interesting distance, so the anchor itself doesn't need to range
;; widely; kept off any single hardcoded "today" so this property isn't
;; quietly pinned to one date the way the wiring test's old fixture was.
(def anchors ["2026-01-05" "2026-02-28" "2026-03-01" "2026-06-30" "2026-12-31" "2027-01-01"])

(defn- offset-date [anchor-str offset-days]
  (str (.plusDays (LocalDate/parse anchor-str) offset-days)))

(defn- gen-input [s]
  (let [[anchor s1] (gen-pick s anchors)
        [shape s2] (gen-pick s1 [:dated :dated :dated :suffixed :non-dated :malformed-today])
        [offset s3] (gen-int s2 11)          ;; 0..10, recentered below
        offset (- offset 5)                  ;; -5..5 days relative to anchor
        dated-name (str (offset-date anchor offset) ".md")]
    (case shape
      :dated [{:today anchor :file dated-name :offset offset} s3]
      :suffixed [{:today anchor :file (str (offset-date anchor offset) "-evening.md") :offset offset} s3]
      :non-dated [{:today anchor :file "README.md" :offset offset} s3]
      :malformed-today [{:today "not-a-date" :file dated-name :offset offset} s3])))

;; Independent reference re-derivation of "in window" - deliberately NOT
;; sharing briefing-in-window?'s implementation, so a shared bug in that
;; implementation isn't invisible to this property.
(defn- reference-in-window? [{:keys [today file]}]
  (boolean
   (try
     (when-let [m (re-matches #"(\d{4}-\d{2}-\d{2})\.md" file)]
       (let [d (LocalDate/parse (second m))
             t (LocalDate/parse today)
             days-old (.between ChronoUnit/DAYS d t)]
         (and (>= days-old 0) (< days-old 2))))
     (catch Exception _ false))))

;; P1: briefing-in-window? never throws and agrees with the independent
;; reference definition, across dated/suffixed/non-dated/malformed-today
;; inputs and offsets spanning well inside to well outside the window.
(check-all
 "P1-window-decision-matches-reference"
 gen-input
 (fn [{:keys [today file] :as input}]
   (let [expected (reference-in-window? input)
         actual (try (briefing-email-lib/briefing-in-window? file today)
                     (catch Exception e (str "threw: " (.getMessage e))))]
     (if (= expected actual)
       true
       (str "expected " expected ", got " (pr-str actual))))))

;; P2: partition-by-window agrees pointwise with briefing-in-window? over a
;; whole generated file list for one shared today-str - the split is
;; exactly a filter/remove pair, never drops or duplicates a name.
(defn- gen-file-list [s]
  (let [[today s1] (gen-pick s anchors)
        [n s2] (gen-int s1 8)
        [names s3]
        (reduce (fn [[acc s] _]
                  (let [[{:keys [file]} s'] (gen-input s)]
                    [(conj acc file) s']))
                [[] s2]
                (range n))]
    [{:today today :files names} s3]))

(check-all
 "P2-partition-matches-pointwise-in-window"
 gen-file-list
 (fn [{:keys [today files]}]
   (let [{:keys [mailable suppressed]} (briefing-email-lib/partition-by-window files today)
         expected-mailable (filterv #(briefing-email-lib/briefing-in-window? % today) files)]
     (cond
       (not= mailable expected-mailable)
       (str "mailable mismatch: got " (pr-str mailable) " want " (pr-str expected-mailable))

       (not= (set suppressed) (set (remove (set mailable) files)))
       (str "suppressed doesn't complement mailable: mailable=" (pr-str mailable) " suppressed=" (pr-str suppressed) " files=" (pr-str files))

       (not= (+ (count mailable) (count suppressed)) (count files))
       (str "partition dropped or duplicated a name: in=" (count files) " out=" (+ (count mailable) (count suppressed)))

       :else true))))

;; generator-reach floor: confirm the generator actually samples true,
;; false, and a malformed-today case within the configured run budget - an
;; assertion, not a hope.
(let [seen-true (atom false) seen-false (atom false) seen-malformed (atom false)]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[{:keys [today] :as input} s'] (gen-input s)]
        (when (reference-in-window? input) (reset! seen-true true))
        (when-not (reference-in-window? input) (reset! seen-false true))
        (when (= today "not-a-date") (reset! seen-malformed true))
        (recur (inc i) s'))))
  (when-not @seen-true (swap! failures conj "FAIL generator-reach: never sampled an in-window case"))
  (when-not @seen-false (swap! failures conj "FAIL generator-reach: never sampled an out-of-window case"))
  (when-not @seen-malformed (swap! failures conj "FAIL generator-reach: never sampled a malformed today-str")))

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str "\n" (count @failures) " property checks failed"))
    (System/exit 1))
  (println (str "ALL PASS: bl821_briefing_window_property_runner.bb (" runs " runs)")))
