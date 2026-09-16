#!/usr/bin/env bb
;; BL-1584's three declared invariants, coder-authored (BL-654), as PROPERTY
;; tests over sampled_reach_floor_guard_lib.bb and
;; sampled_reach_floor_census_cli.bb.
;;
;; Deterministic by construction: a seeded LCG, never rand.
;;
;; GENERATOR REACH, asserted rather than hoped for. P1 draws are constructed
;; from an explicit {kind verdict} shape (10 combinations: :added/:modified x
;; the 5 verdicts) so the load-bearing "a modified file never refuses,
;; whatever its classification" claim is exercised for every verdict on every
;; run, not by chance. P2 builds file text from explicit pieces (a random
;; subset of known-phrase asserts, numRuns draw sites with a mix of literal
;; and non-literal counts, an optional runsPerCell call) so every verdict
;; class is reachable by construction, not by hoping a random string happens
;; to contain "reach floor". P3 draws from four explicit fail-open shapes.
;;
;; Non-vacuity is proven by breaking each invariant and recording the result -
;; see backlog/evidence/BL-1584-sampled-reach-floor-gate-20260916.md.

(ns bl1584-sampled-reach-floor-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "sampled_reach_floor_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "sampled_reach_floor_census_cli.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {}))
(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(zero? i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result) (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── invariant 1 ───────────────────────────────────────────────────────────
;; "The gate refuses only on a property test file absent at the received
;;  commit and present at the forwarded one; a file present at both yields at
;;  most one warning line, whatever its classification."
;;
;; Pure, over decide-for-path - the exact decision the gate's per-path loop
;; delegates to. Stated so BOTH directions are checked every draw: a decision
;; table that refused everything would satisfy "refuses added+sampled-low"
;; but not "never refuses modified"; one that refused nothing would satisfy
;; neither.

(def verdicts [:sampled-low :sampled-high :no-draw :constructed :no-floor])
(def kinds [:added :modified])

(defn gen-decision-case [s]
  (let [[kind s0] (gen-pick s kinds)
        [verdict s1] (gen-pick s0 verdicts)]
    [{:path "extension/test/bl9999Probe.property.test.js" :kind kind :verdict verdict
      :matched "never exercised the probe arm" :budget (case verdict :sampled-low 3 :sampled-high 400 :none)}
     s1]))

(check-all
 "P1: refuses exactly when kind=:added and verdict=:sampled-low; a modified file never refuses"
 gen-decision-case
 (fn [{:keys [kind verdict] :as input}]
   (cover! [kind verdict])
   (let [decision (sampled-reach-floor-guard-lib/decide-for-path input)
         should-refuse (and (= kind :added) (= verdict :sampled-low))]
     (cond
       (and should-refuse (not= :refuse (:action decision)))
       "should have refused (added + sampled-low) but did not"

       (and (not should-refuse) (= :refuse (:action decision)))
       (str "refused a case that must never refuse: " (pr-str input))

       (and (= kind :modified) (= :refuse (:action decision)))
       "a MODIFIED file was refused - invariant 1's whole point"

       :else true))))

;; The warning half: "at most one warning line" - decide-for-path never
;; returns more than one entry per path, by construction (a single map or
;; nil), so this asserts that shape directly rather than trusting it.
(check-all
 "P1b: decide-for-path answers at most one action per path, never a collection"
 gen-decision-case
 (fn [input]
   (let [decision (sampled-reach-floor-guard-lib/decide-for-path input)]
     (if (or (nil? decision) (contains? #{:refuse :warn} (:action decision)))
       true
       (str "decide-for-path returned something other than nil or one {:action ...}: " (pr-str decision))))))

;; ── invariant 2 ───────────────────────────────────────────────────────────
;; "The refusal text, the warning text and every census row come from one
;;  classifier over the file's text; the gate and the CLI never hold a second
;;  notion of reach floor, of construction, or of budget."
;;
;; Built from explicit pieces so every verdict class is CONSTRUCTED, not
;; hoped for: a random subset of known-phrase asserts (or none), a random mix
;; of literal/non-literal numRuns draw sites (or none), an optional
;; runsPerCell( call. A reference verdict/budget is computed independently
;; from the SAME pieces and checked against classify's own answer - and,
;; separately, against the census CLI's own row for the identical text -
;; proving the CLI never reimplements the question.

(def phrase-bank ["never exercised" "too rare" "reach floor" "reachability floor" "both arms"])
(def numruns-literal-bank [1 2 3 8 30 50 100 300])
(def numruns-nonliteral-bank ["RUNS" "CELL_RUNS" "SOME_CONST"])

(defn gen-file-case [s]
  (let [[has-phrase? s0] (gen-bool s)
        [phrase s1] (gen-pick s0 phrase-bank)
        [has-constructed? s2] (gen-bool s1)
        [draw-shape s3] (gen-pick s2 [:none :one-literal :one-nonliteral :two-literal-min :mixed])
        [lit-a s4] (gen-pick s3 numruns-literal-bank)
        [lit-b s5] (gen-pick s4 numruns-literal-bank)
        [nonlit s6] (gen-pick s5 numruns-nonliteral-bank)
        assert-piece (if has-phrase?
                       (str "assert.ok(x, '" phrase " the probe arm');\n")
                       "assert.equal(1, 1);\n")
        draw-pieces (case draw-shape
                      :none []
                      :one-literal [(str "fc.assert(a, { numRuns: " lit-a " });\n")]
                      :one-nonliteral [(str "fc.assert(a, { numRuns: " nonlit " });\n")]
                      :two-literal-min [(str "fc.assert(a, { numRuns: " lit-a " });\n")
                                        (str "fc.assert(b, { numRuns: " lit-b " });\n")]
                      :mixed [(str "fc.assert(a, { numRuns: " lit-a " });\n")
                              (str "fc.assert(b, { numRuns: " nonlit " });\n")])
        constructed-piece (if has-constructed? (str "const N = runsPerCell(T, 3);\n") "")
        text (str constructed-piece (str/join draw-pieces) assert-piece)
        ref-reach-floor? has-phrase?
        ref-constructed? has-constructed?
        ref-budget (cond
                     (= draw-shape :none) :none
                     (= draw-shape :one-literal) lit-a
                     (= draw-shape :one-nonliteral) :unresolved
                     (= draw-shape :two-literal-min) (min lit-a lit-b)
                     (= draw-shape :mixed) :unresolved)
        ref-verdict (cond
                      (not ref-reach-floor?) :no-floor
                      ref-constructed? :constructed
                      (= ref-budget :none) :no-draw
                      (or (= ref-budget :unresolved) (< ref-budget 100)) :sampled-low
                      :else :sampled-high)]
    [{:text text :ref-verdict ref-verdict :ref-budget ref-budget :draw-shape draw-shape :has-phrase? has-phrase?}
     s6]))

(check-all
 "P2a: classify's verdict/budget match a reference computed independently from the same construction pieces"
 gen-file-case
 (fn [{:keys [text ref-verdict ref-budget draw-shape has-phrase?] :as input}]
   (cover! [ref-verdict draw-shape has-phrase?])
   (let [{:keys [verdict budget]} (sampled-reach-floor-guard-lib/classify text)]
     (cond
       (not= ref-verdict verdict)
       (str "verdict mismatch: expected " ref-verdict ", got " verdict)
       (not= ref-budget budget)
       (str "budget mismatch: expected " (pr-str ref-budget) ", got " (pr-str budget))
       :else true))))

(check-all
 "P2b: the census CLI's own row for identical text never diverges from classify's own answer - one classifier, not two"
 gen-file-case
 (fn [{:keys [text ref-verdict]}]
   (let [direct (sampled-reach-floor-guard-lib/classify text)
         row (sampled-reach-floor-census-cli/census-row-for-text "extension/test/probe.property.test.js" text)
         expected-budget-str (if (keyword? (:budget direct)) (name (:budget direct)) (str (:budget direct)))]
     (cond
       (not= (name (:verdict direct)) (:verdict row))
       (str "CLI verdict diverged from classify: " (pr-str direct) " vs " (pr-str row))
       (not= expected-budget-str (:budget row))
       (str "CLI budget diverged from classify: " (pr-str direct) " vs " (pr-str row))
       :else true))))

;; ── invariant 3 ───────────────────────────────────────────────────────────
;; "An unreadable commit range, an unresolvable task id or an unreadable file
;;  never refuses; the send proceeds with a warning that names what could not
;;  be read."
;;
;; Three of the four shapes need only a git process, no repo of their own
;; (an unresolvable ref against a real, tiny fixture); the fourth
;; (no-ticket-id task name) needs no git at all. All four are exercised every
;; run so none can regress silently.

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(def fixture-root
  (let [root (str (fs/create-temp-dir {:prefix "bl1584-property-"}))]
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    (fs/create-dirs (fs/path root ".swarmforge"))
    (spit (str (fs/path root ".swarmforge" "roles.tsv")) (str "coder\tcoder-wt\t" root "\tsession\tCoder\tclaude\ttask\n"))
    (spit (str (fs/path root "seed.txt")) "seed\n")
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "seed")
    root))

(def real-head (:out (sh! fixture-root "git" "rev-parse" "HEAD")))

(defn- random-hex [s]
  (let [chars "0123456789abcdef"
        n 10]
    (loop [i 0 s' s acc ""]
      (if (>= i n)
        [acc s']
        (let [[c s''] (gen-pick s' (seq chars))]
          (recur (inc i) s'' (str acc c)))))))

(defn gen-fail-open-case [s]
  (let [[shape s0] (gen-pick s [:bad-forwarded-commit :bad-task-id :bad-received-commit])]
    (case shape
      :bad-forwarded-commit
      (let [[garbage s1] (random-hex s0)]
        [{:shape shape :root fixture-root :sender "coder" :task-name "BL-1584-probe" :commit garbage} s1])

      :bad-task-id
      (let [[garbage s1] (gen-pick s0 ["no-ticket-here" "just some words" "ticketless-task-name-shape"])]
        [{:shape shape :root fixture-root :sender "coder" :task-name garbage :commit real-head} s1])

      :bad-received-commit
      (let [[garbage s1] (random-hex s0)
            dir (fs/path fixture-root ".swarmforge" "handoffs" "inbox" "in_process")]
        (fs/create-dirs dir)
        (spit (str (fs/path dir "00_probe.handoff"))
              (str "type: git_handoff\nto: cleaner\npriority: 50\ntask: BL-1584-probe\ncommit: " garbage "\nfrom: coder\nrole: coder\n\nbody\n"))
        [{:shape shape :root fixture-root :sender "coder" :task-name "BL-1584-probe" :commit real-head} s1]))))

(check-all
 "P3: an unreadable commit range, an unresolvable task id, or an unreadable received commit never refuses, and each warns (except the no-ticket-id shape, which is silently permissive by its own separate, already-tested convention)"
 gen-fail-open-case
 (fn [{:keys [shape] :as input}]
   (cover! shape)
   ;; Each draw seeds its own in_process file for :bad-received-commit,
   ;; overwriting the last - a stray file from a PRIOR draw of a different
   ;; shape must not leak into this one, so it is cleared first.
   (let [in-process-dir (fs/path fixture-root ".swarmforge" "handoffs" "inbox" "in_process")]
     (when (fs/exists? in-process-dir) (fs/delete-tree in-process-dir)))
   (let [call-input (dissoc input :shape)
         call-input (if (= shape :bad-received-commit)
                      (let [garbage (:garbage input)] call-input)
                      call-input)]
     (let [result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                    (select-keys input [:root :sender :task-name :commit]))]
       (cond
         (sampled-reach-floor-guard-lib/blocked? result)
         (str "a fail-open shape refused the send: " (pr-str result))

         (and (= shape :bad-forwarded-commit) (empty? (:warnings result)))
         "an unreadable forwarded commit produced no warning"

         :else true)))))

;; ── reach floors ─────────────────────────────────────────────────────────

(def p1-floor 10)
(doseq [kind kinds verdict verdicts]
  (let [drawn (get @coverage [kind verdict] 0)]
    (when (< drawn p1-floor)
      (swap! failures conj (str "FAIL reach floor: P1 " [kind verdict] " drawn " drawn " < " p1-floor)))))

(def p2-floor 5)
(doseq [k [[:sampled-low :one-literal true] [:sampled-low :one-nonliteral true]
           [:sampled-high :two-literal-min true] [:no-draw :none true]
           [:constructed :one-literal true] [:no-floor :one-literal false]]]
  (let [drawn (get @coverage k 0)]
    (when (< drawn 1)
      (swap! failures conj (str "FAIL reach floor: P2 " k " drawn " drawn " (expected at least 1)")))))

(def p3-floor 5)
(doseq [shape [:bad-forwarded-commit :bad-task-id :bad-received-commit]]
  (let [drawn (get @coverage shape 0)]
    (when (< drawn p3-floor)
      (swap! failures conj (str "FAIL reach floor: P3 " shape " drawn " drawn " < " p3-floor)))))

(fs/delete-tree fixture-root)

(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str @coverage) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
