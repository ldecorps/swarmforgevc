#!/usr/bin/env bb
;; BL-1576 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over merge_drop_guard_lib.bb, encoding all
;; three declared invariants.
;;
;;   invariant 2 - "A line one side changed is a finding only when the
;;      other side never touched that hunk ... a genuine same-line conflict
;;      is never refused, and a revert excuses it": two generative
;;      sub-properties over the pure core -
;;        (a) contested? agrees with a brute-force per-base-line overlap
;;            check, and is symmetric, across random ranges and points
;;            (covers the adjacency discriminator and the "same insertion
;;            position" clause);
;;        (b) lines-lost agrees with a brute-force set-intersection
;;            definition across random removed/added line sets and
;;            random diff-plus/diff-minus lists, blank lines included as
;;            noise that must never count.
;;
;;   invariant 1 - "computed from git objects and the received parcel
;;      commit recorded in the sender's in_process mailbox alone ... never
;;      from any working tree": a real-git-fixture case, same shape as
;;      BL-1213's own invariant-1 property - a dirty, UNCOMMITTED edit that
;;      would flip the verdict if read is left in place, asserted to leave
;;      the answer unchanged.
;;
;;   invariant 3 - "Bounded to the merge commits reachable from the
;;      forwarded commit and not from the received commit, and to the
;;      paths those merges' parents changed since their merge base - never
;;      a full-tree walk, never a walk past the received commit, never a
;;      merge the sender did not make": two real-git-fixture cases - a
;;      merge already an ancestor of the received commit (one the sender
;;      did NOT make on this hop) is never inspected even though it has a
;;      droppable shape; and a path neither merge parent touched is never
;;      flagged even when it independently differs elsewhere (the
;;      full-tree-walk temptation).
;;
;; Same seeded RNG convention as this directory's other property runners -
;; no shared framework, each runner owns its own loop.
;;
;; Non-vacuity proven by hand at authoring time (mirrors the test runner's
;; own sed-mutation checks): relaxing contested? to `false` fails property
;; 2a on its first overlapping-range case; relaxing lines-lost to ignore
;; blank-line filtering fails property 2b on its first blank-noise case.
;; Both restored before landing.

(ns bl1576-merge-drop-guard-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "merge_drop_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 2000))
(def failures (atom []))
(def ^:private rng (java.util.Random. 1576))
(defn- rint [n] (.nextInt rng (int n)))
(defn- rbool [] (.nextBoolean rng))
(defn- rpick [coll] (nth (vec coll) (rint (count coll))))

;; ── property 2a: contested? vs. a brute-force per-base-line overlap ─────

(defn- hunk-positions
  "Every integer base position a hunk 'occupies', brute-force: the whole
   [start,end] range for a real hunk, or the single point for an insertion -
   exactly hunk-range's own definition, reimplemented independently here so
   the property is not just re-stating the function under test."
  [{:keys [base-start base-count]}]
  (if (pos? base-count)
    (set (range base-start (+ base-start base-count)))
    #{base-start}))

(defn- expected-contested? [a b]
  (boolean (seq (clojure.set/intersection (hunk-positions a) (hunk-positions b)))))

(defn- rhunk []
  (let [start (inc (rint 200))
        count (rpick [0 0 1 1 2 3 6])]
    {:base-start start :base-count count}))

(def overlap-cases-reached (atom 0))
(dotimes [_ runs]
  (let [a (rhunk) b (rhunk)
        expected (expected-contested? a b)
        actual (merge-drop-guard-lib/contested? a b)
        symmetric (merge-drop-guard-lib/contested? b a)]
    (when expected (swap! overlap-cases-reached inc))
    (when (not= expected actual)
      (swap! failures conj (str "FAIL 2a: expected " expected " got " actual " for " (pr-str [a b]))))
    (when (not= actual symmetric)
      (swap! failures conj (str "FAIL 2a symmetry: contested? a b != contested? b a for " (pr-str [a b]))))))

;; The incident's own discriminating shape, asserted directly: adjacent
;; ranges (one hunk's end exactly one less than the other's start) are
;; never contested, whatever the generative loop happened to draw.
(when (merge-drop-guard-lib/contested? {:base-start 33 :base-count 6} {:base-start 39 :base-count 1})
  (swap! failures conj "FAIL invariant 2: adjacent ranges (33-38 vs 39-39) were contested"))
(when-not (merge-drop-guard-lib/contested? {:base-start 40 :base-count 0} {:base-start 40 :base-count 0})
  (swap! failures conj "FAIL invariant 2: two insertions at the same base position were NOT contested"))

(when (zero? @overlap-cases-reached)
  (swap! failures conj "FAIL reachability: no overlapping-hunk pair was ever generated"))

;; ── property 2b: lines-lost vs. a brute-force set-intersection ──────────

(defn- rline [] (rpick ["alpha" "beta" "gamma" "delta" "" "  " "epsilon"]))
(defn- rlines [n] (vec (repeatedly n rline)))

(defn- expected-lines-lost [{:keys [own-uncontested-hunks diff-plus diff-minus]}]
  (let [own-removed (set (remove str/blank? (mapcat :removed own-uncontested-hunks)))
        own-added (set (remove str/blank? (mapcat :added own-uncontested-hunks)))]
    (vec (concat (filter #(and (not (str/blank? %)) (own-removed %)) diff-plus)
                 (filter #(and (not (str/blank? %)) (own-added %)) diff-minus)))))

(def non-empty-loss-reached (atom 0))
(dotimes [_ runs]
  (let [own-hunks [{:removed (rlines (inc (rint 3))) :added (rlines (inc (rint 3)))}]
        diff-plus (rlines (inc (rint 3)))
        diff-minus (rlines (inc (rint 3)))
        scenario {:own-uncontested-hunks own-hunks :diff-plus diff-plus :diff-minus diff-minus}
        expected (expected-lines-lost scenario)
        actual (merge-drop-guard-lib/lines-lost scenario)]
    (when (seq expected) (swap! non-empty-loss-reached inc))
    (when (not= (sort expected) (sort actual))
      (swap! failures conj (str "FAIL 2b: expected " (pr-str expected) " got " (pr-str actual) " for " (pr-str scenario))))))

(when (zero? @non-empty-loss-reached)
  (swap! failures conj "FAIL reachability: lines-lost never found a real loss in the generative loop"))

;; A blank line can never itself be "the" finding, asserted directly (not
;; just via the generative loop's occasional blank draw): a hunk that
;; removed only a blank line, resurrected verbatim, is not a finding.
(when (seq (merge-drop-guard-lib/lines-lost
            {:own-uncontested-hunks [{:removed [""] :added ["   "]}]
             :diff-plus [""] :diff-minus ["   "]}))
  (swap! failures conj "FAIL invariant 2: a blank-line-only resurrection/drop was still flagged"))

;; ── invariant 1: a real git fixture, dirty working tree never read ──────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- write! [root path content] (spit (str (fs/path root path)) content))
(defn- commit! [root message] (sh! root "git" "add" "-A") (sh! root "git" "commit" "-q" "-m" message))
(defn- head [root] (:out (sh! root "git" "rev-parse" "HEAD")))

(defn- init-fixture! [root]
  (sh! root "git" "init" "-q" "-b" "main" ".")
  (sh! root "git" "config" "user.email" "t@t")
  (sh! root "git" "config" "user.name" "t")
  (sh! root "git" "config" "commit.gpgsign" "false")
  (fs/create-dirs (fs/path root ".swarmforge" "handoffs" "inbox" "in_process"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "cleaner\tcleaner-wt\t" root "\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n")))

(def base-lines
  ["base-1" "base-2" "recv-remove-a" "recv-remove-b" "base-5" "base-6"
   "send-remove" "base-8" "base-9" "send-insert-anchor" "base-11" "base-12"
   "recv-insert-anchor" "base-14"])
(defn- lines-str [lines] (str (str/join "\n" lines) "\n"))
(def received-content
  (lines-str ["base-1" "base-2" "base-5" "base-6" "send-remove" "base-8" "base-9"
              "send-insert-anchor" "base-11" "base-12" "recv-insert-anchor" "recv-add-x" "base-14"]))
(def sender-content
  (lines-str ["base-1" "base-2" "recv-remove-a" "recv-remove-b" "base-5" "base-6"
              "base-8" "base-9" "send-insert-anchor" "send-add-y" "base-11" "base-12"
              "recv-insert-anchor" "base-14"]))

(let [root (str (fs/create-temp-dir {:prefix "bl1576-invariant1-"}))]
  (try
    (init-fixture! root)
    (write! root "shared.txt" (lines-str base-lines))
    (commit! root "seed base")
    (let [base-sha (head root)]
      (write! root "shared.txt" received-content)
      (commit! root "BL-1576-fixture: received side")
      (let [received-sha (head root)]
        (sh! root "git" "reset" "-q" "--hard" base-sha)
        (write! root "shared.txt" sender-content)
        (commit! root "BL-1576-fixture: sender side")
        (let [sender-sha (head root)
              tree-sha (:out (sh! root "git" "write-tree"))
              merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" sender-sha "-p" received-sha
                                    "-m" "Merge received into sender (kept sender verbatim)."))]
          (sh! root "git" "update-ref" "refs/heads/main" merge-sha)
          ;; the dirty edit: were the gate to read the WORKING TREE instead
          ;; of the committed merge-commit tree, this would read as the
          ;; fully-correct merge (no finding) - the opposite of the
          ;; committed, git-objects-only truth.
          (write! root "shared.txt" "genuinely unrelated dirty content\n")
          (let [result (merge-drop-guard-lib/findings-between root received-sha merge-sha)]
            (when (empty? result)
              (swap! failures conj "FAIL invariant 1: a dirty uncommitted working-tree edit changed the verdict (expected the committed sender-verbatim finding)"))))))
    (finally (fs/delete-tree root))))

;; ── invariant 3: bounded to received..forwarded, and to touched paths ──

;; (a) a merge already an ancestor of the received commit - one the sender
;;     did NOT make on this hop - is never inspected, even though it has a
;;     droppable shape identical to the flagged case above.
(let [root (str (fs/create-temp-dir {:prefix "bl1576-invariant3a-"}))]
  (try
    (init-fixture! root)
    (write! root "shared.txt" (lines-str base-lines))
    (commit! root "seed base")
    (let [base-sha (head root)]
      (write! root "shared.txt" received-content)
      (commit! root "BL-1576-fixture: pre-existing received-shaped side")
      (let [pre-received-sha (head root)]
        (sh! root "git" "reset" "-q" "--hard" base-sha)
        (write! root "shared.txt" sender-content)
        (commit! root "BL-1576-fixture: pre-existing sender-shaped side")
        (let [pre-sender-sha (head root)
              tree-sha (:out (sh! root "git" "write-tree"))
              ;; this merge (in history BEFORE the ticket's own received
              ;; commit) drops the pre-received side verbatim - the exact
              ;; flagged shape - but it predates "received" below, so it
              ;; is a merge the sender of THIS hop did not make.
              old-merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" pre-sender-sha "-p" pre-received-sha
                                        "-m" "Merge pre-existing history (old, sender-verbatim, pre-dates this hop)."))]
          (sh! root "git" "update-ref" "refs/heads/main" old-merge-sha)
          ;; NOW the ticket's own received commit, and the sender's plain
          ;; (non-merge) forward - the received..forwarded range this
          ;; property bounds the walk to.
          (write! root "other.txt" "received hop content\n")
          (commit! root "BL-1576-fixture: this hop's own received commit")
          (let [received-sha (head root)]
            (write! root "other.txt" "forwarded hop content\n")
            (commit! root "BL-1576-fixture: this hop's own plain forward, no merge")
            (let [forwarded-sha (head root)
                  result (merge-drop-guard-lib/findings-between root received-sha forwarded-sha)]
              (when (seq result)
                (swap! failures conj (str "FAIL invariant 3: a pre-existing merge outside received..forwarded was inspected: " (pr-str result)))))))))
    (finally (fs/delete-tree root))))

;; (b) a path neither merge parent touched since their merge base is never
;;     flagged even when it independently differs elsewhere on the branch -
;;     the full-tree-walk temptation this gate must refuse.
(let [root (str (fs/create-temp-dir {:prefix "bl1576-invariant3b-"}))]
  (try
    (init-fixture! root)
    (write! root "shared.txt" (lines-str base-lines))
    (write! root "unrelated.txt" "unrelated content\n")
    (commit! root "seed base (two files)")
    (let [base-sha (head root)]
      (write! root "shared.txt" received-content)
      (commit! root "BL-1576-fixture: received side")
      (let [received-sha (head root)]
        (sh! root "git" "reset" "-q" "--hard" base-sha)
        (write! root "shared.txt" sender-content)
        (commit! root "BL-1576-fixture: sender side")
        (let [sender-sha (head root)
              tree-sha (:out (sh! root "git" "write-tree"))
              ;; the merge's own tree carries a THIRD, independent edit to
              ;; unrelated.txt that neither parent's diff-from-base
              ;; produced - a full-tree walk would see it differ from
              ;; something and might be tempted to reason about it; this
              ;; gate must not, since diff(base,p1) and diff(base,p2)
              ;; never named unrelated.txt.
              _ (write! root "unrelated.txt" "content the merge itself introduced, unrelated to either side\n")
              _ (sh! root "git" "add" "-A")
              merge-tree (:out (sh! root "git" "write-tree"))
              merge-sha (:out (sh! root "git" "commit-tree" merge-tree "-p" sender-sha "-p" received-sha
                                     "-m" "Merge received into sender (kept sender verbatim, plus an unrelated edit)."))]
          (sh! root "git" "update-ref" "refs/heads/main" merge-sha)
          (let [result (merge-drop-guard-lib/findings-between root received-sha merge-sha)
                paths (set (map :path result))]
            (when (contains? paths "unrelated.txt")
              (swap! failures conj "FAIL invariant 3: a path neither merge parent touched since base was flagged (full-tree walk)"))
            (when (empty? result)
              (swap! failures conj "FAIL invariant 3 setup: the sender-verbatim finding on shared.txt itself went missing"))))))
    (finally (fs/delete-tree root))))

;; ── report ───────────────────────────────────────────────────────────────

(println (str "merge_drop_guard_lib property: " runs " runs"))
(if (seq @failures)
  (do (doseq [f (take 10 @failures)] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
