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

;; ── BL-1216 architect bounce D1: the three declared invariants had no
;;    property test. Encoded here, same seeded-LCG idiom as P1 above. ───────

(def id-words ["alpha" "bravo" "charlie" "delta" "echo" "foxtrot"])

(defn- gen-ticket-id [s]
  (let [[n s'] (gen-int s 9999)]
    [(str "BL-" (+ 1000 n)) s']))

;; A path in a KNOWN pool (paused/active/hold/done) or, occasionally, an
;; "unknown" pool path (e.g. backlog/topics/) to exercise the nil-pool edge -
;; own pool tracked directly (never re-derived via path-pool), so the
;; property's expectation is independent of the function under test.
(defn- gen-path [s]
  (let [[known? s1] (gen-bool s)]
    (if known?
      (let [[pool s2] (gen-pick s1 backlog-hygiene-lib/backlog-pools)
            [id s3] (gen-ticket-id s2)
            [word s4] (gen-pick s3 id-words)]
        [{:pool pool :path (str "backlog/" pool "/" id "-" word ".yaml")} s4])
      (let [[id s2] (gen-ticket-id s1)]
        [{:pool nil :path (str "backlog/topics/" id ".json")} s2]))))

(defn- gen-path-set [s min-n max-n]
  (let [[extra s1] (gen-int s (inc (- max-n min-n)))
        n (+ min-n extra)]
    (loop [i 0 sx s1 acc []]
      (if (= i n)
        [acc sx]
        (let [[p sy] (gen-path sx)]
          (recur (inc i) sy (conj acc p)))))))

;; ── P2 (invariant 1): describe-path's pool/classification suffix always
;;    matches path-pool/pool-classification independently applied to the
;;    same path - checked end to end via format-violation's real output,
;;    the same surface a role actually reads. ─────────────────────────────

(defn- gen-duplicate-id-input [s]
  (let [[subject s1] (gen-path s)
        [others s2] (gen-path-set s1 0 3)]
    [{:subject subject :others others} s2]))

(check-all "P2 (invariant 1) every path in a DUPLICATE-ID finding carries its own pool/classification suffix"
  gen-duplicate-id-input
  (fn [{:keys [subject others]}]
    (let [v {:kind :duplicate-id :id "BL-9001" :path (:path subject)
             :others (mapv (fn [o] {:path (:path o)}) others)}
          out (backlog-hygiene-lib/format-violation v (fn [_] "x"))]
      (loop [candidates (cons subject others)]
        (if (empty? candidates)
          true
          (let [{:keys [pool path]} (first candidates)
                expected-suffix (str "[" (or pool "unknown") "/"
                                      (or (backlog-hygiene-lib/pool-classification pool) "unknown") "]")]
            (if (str/includes? out (str path " " expected-suffix))
              (recur (rest candidates))
              (str "expected " path " to carry suffix " expected-suffix " in " (pr-str out)))))))))

;; sanity: swapping a KNOWN pool for a DIFFERENT known pool in the same
;; generated finding changes the reported classification suffix - proves
;; the property is reading the real per-path suffix, not matching on a
;; constant string every generated case happens to share.
(check-all "P2-sanity a live-pool path reports [pool/live], a terminal-pool path reports [pool/terminal]"
  (fn [s]
    (let [[pool s1] (gen-pick s backlog-hygiene-lib/backlog-pools)
          [id s2] (gen-ticket-id s1)]
      [{:pool pool :path (str "backlog/" pool "/" id "-x.yaml")} s2]))
  (fn [{:keys [pool path]}]
    (let [v {:kind :duplicate-id :id "BL-9001" :path path :others [{:path "backlog/paused/BL-1-sibling.yaml"}]}
          out (backlog-hygiene-lib/format-violation v (fn [_] "x"))
          expected-class (backlog-hygiene-lib/pool-classification pool)]
      (if (str/includes? out (str "[" pool "/" expected-class "]"))
        true
        (str "expected [" pool "/" expected-class "] in " (pr-str out))))))

;; ── P3 (invariant 2): content-verdict returns CONTENT IDENTICAL iff every
;;    path in the set maps to the exact same content; any missing path or
;;    differing content forces CONTENT DIFFERS. ───────────────────────────

(def content-words ["one" "two" "three" "four" "five"])

(defn- gen-content-verdict-input [s]
  (let [[subject-path s1] (gen-path s)
        [others s2] (gen-path-set s1 0 3)
        [subject-readable? s3] (gen-bool s2)
        [subject-content s4] (gen-pick s3 content-words)
        subject-path (:path subject-path)
        others-paths (mapv :path others)]
    (loop [remaining others-paths sx s4 content-map (if subject-readable? {subject-path subject-content} {})]
      (if (empty? remaining)
        [{:subject-path subject-path :others-paths others-paths :content-map content-map} sx]
        (let [[readable? sy] (gen-bool sx)
              [same? sz] (gen-bool sy)
              [other-content sw] (gen-pick sz content-words)]
          (recur (rest remaining) sw
                 (if readable?
                   (assoc content-map (first remaining) (if same? subject-content other-content))
                   content-map)))))))

(check-all "P3 (invariant 2) content-verdict is CONTENT IDENTICAL iff every path maps to the exact same content"
  gen-content-verdict-input
  (fn [{:keys [subject-path others-paths content-map]}]
    (let [read-fn (fn [p] (if (contains? content-map p) (get content-map p) (throw (Exception. "unreadable"))))
          verdict (backlog-hygiene-lib/content-verdict subject-path others-paths read-fn)
          subject-content (get content-map subject-path)
          all-identical? (and (some? subject-content)
                               (every? #(= subject-content (get content-map %)) others-paths))]
      (cond
        (and all-identical? (= verdict "CONTENT IDENTICAL")) true
        (and (not all-identical?) (= verdict "CONTENT DIFFERS")) true
        :else (str "expected " (if all-identical? "CONTENT IDENTICAL" "CONTENT DIFFERS") ", got " verdict)))))

;; sanity: an unreadable SUBJECT (never in content-map) always forces
;; CONTENT DIFFERS even when every other path happens to share content with
;; each other - proves the property isn't vacuously true because the
;; generator rarely produces an unreadable subject.
(check-all "P3-sanity an unreadable subject always forces CONTENT DIFFERS, regardless of the others"
  (fn [s]
    (let [[others s1] (gen-path-set s 1 3)
          [content s2] (gen-pick s1 content-words)]
      [{:others-paths (mapv :path others) :content content} s2]))
  (fn [{:keys [others-paths content]}]
    (let [content-map (into {} (map (fn [p] [p content])) others-paths)
          read-fn (fn [p] (if (contains? content-map p) (get content-map p) (throw (Exception. "unreadable"))))
          verdict (backlog-hygiene-lib/content-verdict "backlog/active/BL-0-unreadable.yaml" others-paths read-fn)]
      (if (= verdict "CONTENT DIFFERS") true (str "expected CONTENT DIFFERS, got " verdict)))))

;; ── P4 (invariant 3): a DUPLICATE-ID finding names a copy to keep iff
;;    exactly one candidate (subject + others) classifies as live, and that
;;    named copy is exactly the live one. ──────────────────────────────────

(check-all "P4 (invariant 3) keep: appears iff exactly one candidate is live, and names exactly that path"
  gen-duplicate-id-input
  (fn [{:keys [subject others]}]
    (let [candidates (cons subject others)
          live (filter #(= "live" (backlog-hygiene-lib/pool-classification (:pool %))) candidates)
          v {:kind :duplicate-id :id "BL-9001" :path (:path subject)
             :others (mapv (fn [o] {:path (:path o)}) others)}
          out (backlog-hygiene-lib/format-violation v (fn [_] "x"))]
      (cond
        (and (= 1 (count live)) (str/includes? out (str "keep: " (:path (first live))))) true
        (and (not= 1 (count live)) (not (str/includes? out "keep:"))) true
        :else (str "candidates=" (pr-str candidates) " live-count=" (count live) " out=" (pr-str out))))))

;; sanity: exactly two live candidates never names a keep (proves the
;; property isn't vacuously true because the generator rarely produces
;; exactly one live path).
(check-all "P4-sanity two live candidates never name a keep"
  (fn [s]
    (let [[id1 s1] (gen-ticket-id s)
          [id2 s2] (gen-ticket-id s1)
          [pool1 s3] (gen-pick s2 (vec backlog-hygiene-lib/live-pools))
          [pool2 s4] (gen-pick s3 (vec backlog-hygiene-lib/live-pools))]
      [{:subject-path (str "backlog/" pool1 "/" id1 "-x.yaml")
        :other-path (str "backlog/" pool2 "/" id2 "-y.yaml")} s4]))
  (fn [{:keys [subject-path other-path]}]
    (let [v {:kind :duplicate-id :id "BL-9001" :path subject-path :others [{:path other-path}]}
          out (backlog-hygiene-lib/format-violation v (fn [_] "x"))]
      (if (str/includes? out "keep:") (str "unexpected keep: in " (pr-str out)) true))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "backlog_hygiene_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
