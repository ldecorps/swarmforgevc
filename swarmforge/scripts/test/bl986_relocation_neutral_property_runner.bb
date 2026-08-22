#!/usr/bin/env bb
;; BL-986 coder pass (BL-654 Invariants): a PROPERTY over
;; standing_rule_violations_lib.bb's scan-violations, encoding the ticket's
;; one declared invariant:
;;
;;   "A rule citation counts as a violation record wherever the
;;    constitution keeps it - moving prose between a boot-inlined article
;;    and its reference/ elaboration never changes the reported violation
;;    count."
;;
;; The lib test runner pins three hand-picked placements of one rule. This
;; quantifies the same claim: for ANY generated set of rules, ANY assignment
;; of each rule to inlined-only / reference-only / BOTH, and ANY ticket, the
;; reported count is identical to the count when every rule sits inlined.
;; That is the real content of "verdict-neutral" - the placement is not
;; supposed to be an input to the answer at all.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none),
;; and the same Babashka-property-tooling-gap note (BL-472): no test.check
;; equivalent is wired for .bb scripts, so this is a hand-rolled generator
;; in the actual enforced gate for .bb code (swarmforge/scripts/test/).
;;
;; Generator reach is asserted, not hoped for: every placement - including
;; BOTH, the one that turns an under-count into an over-count if dedup is
;; missing - must be sampled, or the run fails as unreachable rather than
;; passing vacuously.
;;
;; Non-vacuity proven at authoring time, both ways: removing the
;; distinct-by dedup from scan-violations fails this immediately on the
;; first generated case placing a rule in BOTH (count 2 against an expected
;; 1); and reverting scan-violations to ignore the reference file's records
;; fails every reference-only case (count 0 against an expected 1). Both
;; were restored and the property passed again.

(ns bl986-relocation-neutral-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "standing_rule_violations_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def placements [:inlined :reference :both])

;; A rule block in this project's own authoring style: a dash bullet whose
;; prose carries a parenthetical citing the tickets that found it again.
;; origin is the numerically smallest cited ticket and is never a violation
;; of its own rule; every larger one is.
(defn- rule-text [{:keys [id origin extras]}]
  (str "- Standing rule number " id " about something that keeps biting.\n"
       "  (Confirmed across BL-" origin
       (apply str (map #(str "/BL-" %) extras))
       " in one session.)\n"))

(defn- gen-rule [s i]
  (let [[origin s1] (gen-int s 400)
        [n-extras s2] (gen-int s1 3)
        [placement s3] (gen-pick s2 placements)
        ;; extras are strictly larger than origin by construction, so each
        ;; is a genuine violation and the origin stays the smallest.
        extras (mapv #(+ origin 500 (* 7 %) i) (range (inc n-extras)))]
    [{:id i :origin (+ 100 origin) :extras extras :placement placement} s3]))

(defn- gen-input [s]
  (let [[n s1] (gen-int s 5)
        rules (loop [i 0 st s1 acc []]
                (if (>= i (inc n))
                  [acc st]
                  (let [[r st'] (gen-rule st i)] (recur (inc i) st' (conj acc r)))))]
    [{:rules (first rules)} (second rules)]))

(defn- files-for [rules placement-of]
  (let [pick (fn [want] (->> rules
                             (filter #(contains? (placement-of %) want))
                             (map rule-text)
                             (apply str)))]
    [{:path "swarmforge/constitution/articles/engineering.prompt" :content (pick :inlined)}
     {:path "swarmforge/constitution/articles/reference/engineering-detailed.prompt" :content (pick :reference)}]))

(defn- counts-by-ticket [files tickets]
  (let [violations (standing-rule-violations-lib/scan-violations files)]
    (into {} (map (fn [t] [t (count (standing-rule-violations-lib/citing-rules-for-ticket violations t))]) tickets))))

;; Every ticket any generated rule mentions - origins (which must count 0
;; against their own rule) and violations alike.
(defn- all-tickets [rules]
  (vec (distinct (mapcat (fn [r] (cons (str "BL-" (:origin r)) (map #(str "BL-" %) (:extras r)))) rules))))

(def seen-placements (atom #{}))

(defn- check-relocation-neutral [{:keys [rules]}]
  (swap! seen-placements into (map :placement rules))
  (let [tickets (all-tickets rules)
        ;; The oracle: every rule inlined, the shape the scanner was
        ;; originally written against.
        baseline (counts-by-ticket (files-for rules (constantly #{:inlined})) tickets)
        ;; The actual generated placement - some relocated, some in both.
        actual (counts-by-ticket
                 (files-for rules (fn [r] (case (:placement r)
                                            :inlined #{:inlined}
                                            :reference #{:reference}
                                            :both #{:inlined :reference})))
                 tickets)]
    (if (= baseline actual)
      true
      (str "placement changed the verdict:\n    baseline: " (pr-str baseline)
           "\n    actual:   " (pr-str actual)))))

(loop [i 0 s 13]
  (when (< i runs)
    (let [[input s'] (gen-input s)
          result (try (check-relocation-neutral input)
                      (catch Exception e (str "threw: " (.getMessage e))))]
      (when-not (true? result)
        (report! "relocation-neutral" s input (str result)))
      (recur (inc i) s'))))

(doseq [p placements]
  (when-not (contains? @seen-placements p)
    (swap! failures conj (str "FAIL generator-reach: never sampled placement " p
                              " across the configured run budget - the property cannot have tested it"))))

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str "\n" (count @failures) " of " runs " property checks failed"))
    (System/exit 1))
  (println (str "ALL PASS: bl986_relocation_neutral_property_runner.bb (" runs " runs)")))
