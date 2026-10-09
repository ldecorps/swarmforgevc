#!/usr/bin/env bb
;; BL-2087's two declared invariants, coder-authored (BL-654), as PROPERTY
;; tests over sampled_reach_floor_guard_lib.bb's findings-for-git-handoff.
;;
;; Deterministic by construction: a seeded LCG, never rand.
;;
;; GENERATOR REACH, asserted rather than hoped for. P1 draws from an
;; explicit {has-pre-existing? verdict-shape} grid (2 x 5 = 10 combinations)
;; so both "added" and "modified" are exercised for every verdict shape on
;; every run. P2 draws from two explicit baseline shapes (merge-base exists
;; / does not) so the "cannot establish a baseline" arm is reached by
;; construction every run, never by chance.
;;
;; Non-vacuity is proven by breaking each invariant and recording the
;; result - see backlog/evidence/BL-2087-coder-20261009.md.

(ns bl2087-first-send-reach-floor-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "sampled_reach_floor_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))
(def coverage (atom {}))
(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 1]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result) (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── shared fixture plumbing (mirrors bl1584_sampled_reach_floor_property_runner.bb) ──

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(def fixture-root
  (let [root (str (fs/create-temp-dir {:prefix "bl2087-property-"}))]
    (.addShutdownHook (Runtime/getRuntime)
                       (Thread. (fn [] (when (fs/exists? root) (fs/delete-tree root)))))
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

(def TASK "BL-2087-property-fixture")

(defn- write-file! [path content]
  (fs/create-dirs (fs/parent (fs/path fixture-root path)))
  (spit (str (fs/path fixture-root path)) content))

(defn- commit! [path content message]
  (write-file! path content)
  (sh! fixture-root "git" "add" "-A")
  (sh! fixture-root "git" "commit" "-q" "-m" message))

(defn- head [] (:out (sh! fixture-root "git" "rev-parse" "HEAD")))

(defn- in-process-dir [] (fs/path fixture-root ".swarmforge" "handoffs" "inbox" "in_process"))

(defn- clear-mailbox! []
  (let [dir (in-process-dir)]
    (when (fs/exists? dir) (fs/delete-tree dir))))

(defn- seed-work-note! []
  (fs/create-dirs (in-process-dir))
  (spit (str (fs/path (in-process-dir) "00_work.handoff"))
        (str "type: note\nto: coder\npriority: 10\nmessage: Work " TASK ": merge main first\n")))

(defn- seed-git-handoff! [commit-sha]
  (fs/create-dirs (in-process-dir))
  (spit (str (fs/path (in-process-dir) "00_received.handoff"))
        (str "type: git_handoff\nto: cleaner\npriority: 50\ntask: " TASK
             "\ncommit: " commit-sha "\nfrom: coder\nrole: coder\n\nbody\n")))

;; ── invariant 1 ───────────────────────────────────────────────────────────
;; "Whether a property test file counts as added never depends on the shape
;;  of the sender's inbound (a Work note, a git_handoff, or none): it is
;;  absent at the parcel's base and present at its commit."
;;
;; For the SAME {base, commit} pair, three inbound shapes must produce the
;; IDENTICAL {:findings :warnings}: no in_process file at all, a Work note
;; (no commit header), and a git_handoff whose own commit: header equals
;; base exactly - the one case received-commit-for-task actually returns a
;; value, which must agree with the merge-base fallback's own answer.

(def verdict-texts
  {:sampled-low "fc.assert(a, { numRuns: 3 }); assert.ok(x, 'never exercised the thing');"
   :sampled-high "fc.assert(a, { numRuns: 400 }); assert.ok(x, 'reachability floor never produced it');"
   :no-draw "assert.ok(x, 'never exercised the thing');"
   :constructed "const N = runsPerCell(T, 3); assert.ok(x, 'never exercised the thing');"
   :no-floor "fc.assert(a, { numRuns: 3 }); assert.equal(1,1);"})

(def verdict-shapes (vec (keys verdict-texts)))

;; BL-2087: path/branch uniqueness is a FIXTURE concern, never a test
;; input - a global counter, never the LCG's own draw. Two check-all runs
;; sharing one fixture-root each restart their LCG from the same seed, and
;; drawing a DIFFERENT number of values per case (P1: 3, P2: 2) means their
;; uniq sequences alias against each other (empirically ~1/3 of draws
;; collided) - a P2 "coder-branch-<n>" that already exists from P1 makes
;; `git checkout -b` fail silently (sh!'s own :continue true), leaving the
;; commit on main itself and turning every :added case into :modified.
(def next-id! (let [counter (atom 0)] (fn [] (swap! counter inc))))

(defn gen-invariant1-case [s]
  (let [[has-pre-existing? s0] (gen-pick s [true false])
        [verdict s1] (gen-pick s0 verdict-shapes)]
    [{:has-pre-existing? has-pre-existing? :verdict verdict} s1]))

(check-all
 "P1: added-vs-modified classification (and its outcome) never depends on the shape of the sender's inbound - none, a Work note, or a git_handoff whose commit equals the base"
 gen-invariant1-case
 (fn [{:keys [has-pre-existing? verdict]}]
   (cover! [has-pre-existing? verdict])
   (clear-mailbox!)
   (let [uniq (next-id!)
         path (str "extension/test/bl" uniq "Probe.property.test.js")
         text (get verdict-texts verdict)]
     (when has-pre-existing?
       (commit! path text (str "BL-2087: pre-existing " uniq)))
     (let [base (head)
           _ (sh! fixture-root "git" "checkout" "-q" "-b" (str "coder-branch-" uniq))
           _ (commit! path (if has-pre-existing? (str text "\n// touched") text) (str "BL-2087: parcel " uniq))
           commit (head)]
       (sh! fixture-root "git" "checkout" "-q" "main")
       (let [call (fn [] (sampled-reach-floor-guard-lib/findings-for-git-handoff
                          {:root fixture-root :sender "coder" :task-name TASK :commit commit}))
             ;; shape A: nothing in in_process at all.
             a (do (clear-mailbox!) (call))
             ;; shape B: a Work note, no commit header.
             b (do (clear-mailbox!) (seed-work-note!) (call))
             ;; shape C: a git_handoff whose own commit: equals base exactly.
             c (do (clear-mailbox!) (seed-git-handoff! base) (call))]
         (cond
           (not= a b)
           (str "no-inbound shape disagreed with the Work-note shape: " (pr-str a) " vs " (pr-str b))
           (not= b c)
           (str "the Work-note shape disagreed with the git_handoff-at-base shape: " (pr-str b) " vs " (pr-str c))
           (and has-pre-existing? (= verdict :sampled-low) (sampled-reach-floor-guard-lib/blocked? a))
           "a MODIFIED (pre-existing) sampled-low file was refused - invariant 1's whole point"
           (and (not has-pre-existing?) (= verdict :sampled-low) (not (sampled-reach-floor-guard-lib/blocked? a)))
           "an ADDED sampled-low file was not refused"
           :else true))))))

;; ── invariant 2 ───────────────────────────────────────────────────────────
;; "The gate never sends silently when it cannot establish a baseline: it
;;  decides, or it prints a warning naming the ticket."
;;
;; Two explicit baseline shapes: a resolvable merge-base (the gate decides -
;; findings/warnings reflect a real classification) and NO resolvable
;; merge-base at all (an orphan branch, unrelated to main) - which must warn,
;; name the task, and never refuse on a guess.

(defn gen-invariant2-case [s]
  (let [[has-base? s0] (gen-pick s [true false])]
    [{:has-base? has-base?} s0]))

(check-all
 "P2: with no received commit, a resolvable base lets the gate decide; an unresolvable one (orphan history) always warns, names the task, and never refuses"
 gen-invariant2-case
 (fn [{:keys [has-base?]}]
   (cover! has-base?)
   (clear-mailbox!)
   (let [uniq (next-id!)
         path (str "extension/test/bl" uniq "Probe.property.test.js")
         text (:sampled-low verdict-texts)]
     (if has-base?
       (do
         (sh! fixture-root "git" "checkout" "-q" "-b" (str "coder-branch-" uniq))
         (commit! path text (str "BL-2087: parcel " uniq))
         (let [commit (head)
               result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                       {:root fixture-root :sender "coder" :task-name TASK :commit commit})]
           (sh! fixture-root "git" "checkout" "-q" "main")
           (if (sampled-reach-floor-guard-lib/blocked? result)
             true
             (str "a resolvable base must let the gate DECIDE - an added sampled-low file must refuse: " (pr-str result)))))
       (do
         (sh! fixture-root "git" "checkout" "-q" "--orphan" (str "unrelated-" uniq))
         (commit! path text (str "BL-2087: orphan " uniq))
         (let [commit (head)
               result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                       {:root fixture-root :sender "coder" :task-name TASK :commit commit})]
           (sh! fixture-root "git" "checkout" "-q" "main")
           (cond
             (sampled-reach-floor-guard-lib/blocked? result)
             (str "no resolvable base must never refuse on a guess: " (pr-str result))
             (empty? (:warnings result))
             (str "no resolvable base must never send silently - expected a warning: " (pr-str result))
             (not (some #(str/includes? % TASK) (:warnings result)))
             (str "the warning must name the task: " (pr-str result))
             :else true)))))))

;; ── reach floors ─────────────────────────────────────────────────────────

(def p1-floor 5)
(doseq [has-pre [true false] verdict verdict-shapes]
  (let [drawn (get @coverage [has-pre verdict] 0)]
    (when (< drawn p1-floor)
      (swap! failures conj (str "FAIL reach floor: P1 " [has-pre verdict] " drawn " drawn " < " p1-floor)))))

(def p2-floor 10)
(doseq [shape [true false]]
  (let [drawn (get @coverage shape 0)]
    (when (< drawn p2-floor)
      (swap! failures conj (str "FAIL reach floor: P2 " shape " drawn " drawn " < " p2-floor)))))

(when (fs/exists? fixture-root) (fs/delete-tree fixture-root))

(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str @coverage) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
