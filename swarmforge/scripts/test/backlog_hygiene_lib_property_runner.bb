#!/usr/bin/env bb
;; BL-922 (coder pass): PROPERTY test encoding the ticket's third declared
;; invariant: "A ticket whose acceptance body names no feature file is
;; never reported by this check, at any call site. Honest not-yet-drafted
;; placeholders are BL-626's business, not this gate's."
;;
;; The other two declared invariants are architectural, not generator-
;; quantified properties, so they are not encoded here (coder prompt's
;; Invariants section: a stated reason stands in for an invariant that
;; "quantifies over prose or process rather than a pure, testable
;; module"):
;;   1. "the residue notion must be consulted from the existing gate lib,
;;      not restated" - satisfied by construction: backlog_hygiene_lib.bb
;;      calls acceptance-pointer-gate-lib/block-scalar-residue? directly
;;      (one call site, same process, same language) rather than holding a
;;      second copy of the regex. Unlike BL-897's TS<->Babashka mirrored
;;      constant (which needed a sync-test because no import can bridge
;;      that boundary), a same-language direct call cannot drift - there is
;;      only one definition to change.
;;   2. "the gate is read-only... never repairs a ticket in place" -
;;      unreadable-acceptance-violation/violations-for-text take a string
;;      and return data; nothing in the call chain performs file I/O,
;;      exactly the same shape the pre-existing missing-epic/
;;      missing-milestone checks have always had. Inspectable directly in
;;      the diff; no mutation exists for a property test to catch.
;;
;; Deterministic by construction: a seeded LCG, never rand (mirrors
;; mono_router_lib_property_runner.bb's own generator shape).
;;
;; Non-vacuity proven by hand at authoring time: run against a deliberately
;; broken unreadable-acceptance-violation that reports a violation whenever
;; the acceptance: line is block-scalar residue, regardless of what the
;; body contains (i.e. drops the `feature-path` conjunct entirely) - failed
;; on the very first generated input, confirming the property is actually
;; sensitive to the feature-path check, not vacuously true because the
;; generator never produces a block-scalar acceptance: line.

(ns backlog-hygiene-lib-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "backlog_hygiene_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors mono_router_lib_property_runner.bb) ────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop input msg]
  (swap! failures conj (str "FAIL " prop "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result) (report! prop input (str result)))
        (recur (inc i) s')))))

;; ── generators: block-scalar acceptance: lines whose body deliberately
;;    never contains a specs/features/*.feature-shaped path ──────────────

(def indicators ["|" "|-" "|+" ">" ">-"])
(def prose-words
  ["Specifier" "writes" "the" "scenarios" "Minimum" "covers" "happy" "path"
   "edge" "case" "TBD" "contract" "notes" "review" "later" "acceptance"
   "criteria" "spec" "gherkin" "TODO" "draft"])

(defn gen-prose-line [s]
  (let [[extra s1] (gen-int s 6)
        n (inc extra)]
    (loop [i 0 sx s1 words []]
      (if (= i n)
        [(str "  " (str/join " " words)) sx]
        (let [[w sy] (gen-pick sx prose-words)]
          (recur (inc i) sy (conj words w)))))))

(defn gen-non-feature-body [s]
  (let [[extra s1] (gen-int s 5)
        n (inc extra)]
    (loop [i 0 sx s1 lines []]
      (if (= i n)
        [lines sx]
        (let [[l sy] (gen-prose-line sx)]
          (recur (inc i) sy (conj lines l)))))))

(defn gen-input [s]
  (let [[indicator s1] (gen-pick s indicators)
        [body s2] (gen-non-feature-body s1)]
    [{:indicator indicator :body body} s2]))

(defn- ticket-text [{:keys [indicator body]}]
  (str "id: BL-991\ntitle: t\ntype: feature\nepic: e\nmilestone: M8\n"
       "acceptance: " indicator "\n"
       (str/join "\n" body) "\n"
       "priority: 5\n"))

;; ── P1 (invariant 3) ──────────────────────────────────────────────────────

(check-all "P1 a block-scalar acceptance: whose body names no feature-file path is never reported as unreadable-acceptance"
  gen-input
  (fn [input]
    (let [text (ticket-text input)
          v (backlog-hygiene-lib/unreadable-acceptance-violation text {:id "BL-991" :path "fixture.yaml"})]
      (if (nil? v) true (str "expected nil (no feature path in body), got " (pr-str v))))))

;; sanity: the SAME generator shape, with a real feature path injected into
;; the body, DOES trigger - proves the negative-space property above isn't
;; vacuously true because block-scalar bodies never reach the check at all.
(check-all "P1-sanity injecting a real feature path into the same generator shape DOES trigger a violation"
  gen-input
  (fn [{:keys [indicator body] :as input}]
    (let [text (ticket-text {:indicator indicator :body (conj body "  specs/features/BL-042-example.feature")})
          v (backlog-hygiene-lib/unreadable-acceptance-violation text {:id "BL-991" :path "fixture.yaml"})]
      (if (= (:kind v) :unreadable-acceptance) true (str "expected a violation once a feature path is present, got " (pr-str v))))))

;; ── generator coverage, asserted rather than assumed ─────────────────────

(let [indicator-counts (loop [i 0 s 7 acc {}]
                          (if (= i runs) acc
                            (let [[{:keys [indicator]} s'] (gen-input s)]
                              (recur (inc i) s' (update acc indicator (fnil inc 0))))))
      floor (quot runs 20)]
  (println (str "  generator coverage (indicators): " (pr-str indicator-counts)))
  (doseq [ind indicators]
    (when (< (get indicator-counts ind 0) floor)
      (report! (str "COVERAGE indicator " ind) nil "barely exercised"))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "backlog_hygiene_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
