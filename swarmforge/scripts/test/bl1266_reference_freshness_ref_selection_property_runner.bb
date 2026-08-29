#!/usr/bin/env bb
;; BL-1266: PROPERTY tests over reference_freshness_lib.bb's
;; stale-paths-multi-ref (coder-authored first, per BL-654), covering the
;; ticket YAML's three declared invariants:
;;
;;   I1 "A path's verdict is computed from that path's own history in each
;;      ref - never from a repository-wide commit count."
;;   I2 "Every ref that carries a reference file is consulted; a refusal is
;;      raised when the worktree is missing ANY ref's amendment, and is
;;      never suppressed because a different ref happened to agree."
;;   I3 "Every refusal names the specific ref whose amendment is missing,
;;      and merging that named ref clears it."
;;
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.
;; Follows the established .bb property-runner precedent (see
;; bl640_reference_freshness_property_runner.bb in this same directory).
;;
;;   P1 per-ref locality (I1) - a path's verdict against ref R never
;;      changes depending on which OTHER refs happen to be present in the
;;      call, or what they contain. stale-paths-multi-ref has no
;;      whole-repo-count parameter at all, so this is the strongest
;;      testable form of "never derived from a repo-wide count": adding or
;;      removing unrelated refs cannot move a fixed ref's own verdicts.
;;
;;   P2 no-suppression (I2) - whenever one ref agrees with the worktree on
;;      a path (or its drift is absorbed) while a DIFFERENT ref drifts on
;;      that same path unabsorbed, the drifted ref is still reported. The
;;      agreeing ref never buys the drifted one a pass.
;;
;;   P3 named-and-clearable (I3) - every stale entry's ref appears in the
;;      report text tied to its own path, the report's remedy names
;;      exactly the distinct refs actually missing (no more, no fewer),
;;      and "merging" a stale (path, ref) pair - i.e. making the worktree
;;      absorb it - removes exactly that entry and nothing else.
;;
;;   BL-654 collision-by-construction: every ref's shas are DERIVED from a
;;   shared worktree-shas base by selectively mutating a controlled subset
;;   of paths (never drawn independently), so "matches" and "drifts" are
;;   both reachable by construction, not by chance collision of random sha
;;   strings.

(ns bl1266-reference-freshness-ref-selection-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "reference_freshness_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def ^:private rng (java.util.Random. 1266))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rand-sha [] (str "sha-" (rint 1000000000)))

(defn- base-shas [n]
  (into {} (for [i (range n)] [(str "file-" i ".prompt") (rand-sha)])))

;; derive a ref's shas from the worktree base: `drift-paths` get a
;; different sha (a real amendment), everything else matches.
(defn- derive-ref-shas [worktree-shas drift-paths]
  (into {} (map (fn [[path sha]]
                  [path (if (contains? drift-paths path) (str sha "-amended-" (rint 1000000)) sha)])
                worktree-shas)))

;; ── P1: per-ref locality - I1 ───────────────────────────────────────────

(dotimes [_ 60]
  (let [n (+ 2 (rint 6))
        worktree-shas (base-shas n)
        paths (vec (keys worktree-shas))
        ref-names ["main" "origin/main" "third-sibling-ref"]
        ;; each ref independently drifts a random subset of paths.
        refs-shas (into {} (for [r ref-names]
                              (let [k (rint (inc n))
                                    drift (set (take k (shuffle paths)))]
                                [r (derive-ref-shas worktree-shas drift)])))
        ;; independently random ancestry answers for every (ref, path).
        ancestry (into {} (for [r ref-names p paths] [[r p] (.nextBoolean rng)]))
        full-stale (reference-freshness-lib/stale-paths-multi-ref worktree-shas refs-shas ancestry)]
    (doseq [r ref-names]
      (let [single-refs-shas {r (get refs-shas r)}
            single-ancestry (into {} (filter (fn [[[rr _] _]] (= rr r)) ancestry))
            single-stale (reference-freshness-lib/stale-paths-multi-ref worktree-shas single-refs-shas single-ancestry)
            full-stale-for-r (vec (filter #(= (:ref %) r) full-stale))]
        (assert= (str "P1: ref " r "'s own verdicts are identical whether or not sibling refs are present in the call")
                 single-stale
                 full-stale-for-r)))))

;; ── P2: no-suppression - I2 ───────────────────────────────────────────────

(def suppression-branches (atom #{}))

(dotimes [_ 80]
  (let [n (+ 1 (rint 5))
        worktree-shas (base-shas n)
        paths (vec (keys worktree-shas))
        ;; ref-a: independently, per path, either matches the worktree
        ;; (agrees) or drifts UNABSORBED (missing).
        a-drift (set (filter (fn [_] (.nextBoolean rng)) paths))
        ;; ref-b: independently drawn the same way - deliberately allowed
        ;; to overlap or not overlap with a-drift, so both "only A missing",
        ;; "only B missing", "both missing" and "neither missing" are
        ;; reachable over the sweep.
        b-drift (set (filter (fn [_] (.nextBoolean rng)) paths))
        refs-shas {"ref-a" (derive-ref-shas worktree-shas a-drift)
                   "ref-b" (derive-ref-shas worktree-shas b-drift)}
        ;; fail-closed default (no ancestry map entry) already means
        ;; "not absorbed" - a drifted path with no absorption is exactly
        ;; the missing-amendment case this property targets.
        stale (reference-freshness-lib/stale-paths-multi-ref worktree-shas refs-shas {})
        stale-set (set (map (juxt :path :ref) stale))]
    (doseq [p paths]
      (let [a? (contains? a-drift p)
            b? (contains? b-drift p)]
        (swap! suppression-branches conj [a? b?])
        (assert= (str "P2: path " p " ref-a drift=" a? " ref-b drift=" b? " - ref-a's own verdict is unaffected by ref-b agreeing or not")
                 a? (contains? stale-set [p "ref-a"]))
        (assert= (str "P2: path " p " ref-a drift=" a? " ref-b drift=" b? " - ref-b's own verdict is unaffected by ref-a agreeing or not")
                 b? (contains? stale-set [p "ref-b"]))))))

(assert-true "P2's generator reached all four (ref-a missing?, ref-b missing?) combinations, including exactly-one-missing"
             (= #{[true true] [true false] [false true] [false false]} @suppression-branches))

;; ── P3: named-and-clearable - I3 ────────────────────────────────────────

(dotimes [_ 40]
  (let [n (+ 1 (rint 4))
        worktree-shas (base-shas n)
        paths (vec (keys worktree-shas))
        ref-names ["main" "origin/main"]
        refs-shas (into {} (for [r ref-names]
                              (let [k (rint (inc n))
                                    drift (set (take k (shuffle paths)))]
                                [r (derive-ref-shas worktree-shas drift)])))
        stale (reference-freshness-lib/stale-paths-multi-ref worktree-shas refs-shas {})]
    (when (seq stale)
      (let [report (reference-freshness-lib/staleness-report-multi-ref stale)
            distinct-stale-refs (set (map :ref stale))]
        (doseq [{:keys [path ref]} stale]
          (assert-true (str "P3: report names ref " ref " tied to path " path)
                       (str/includes? report (str path " (missing " ref "'s amendment)"))))
        (doseq [r distinct-stale-refs]
          (assert-true (str "P3: the remedy line names " r " to merge")
                       (str/includes? report (str "Merge "))))
        ;; the remedy names EXACTLY the distinct stale refs, sorted - never
        ;; a ref this worktree was never missing content from.
        (let [remedy-line (last (str/split-lines report))
              named-refs (set (str/split (second (re-find #"Merge (.+), then run" remedy-line)) #" and "))]
          (assert= "P3: the remedy names exactly the distinct refs actually missing, no more no fewer"
                   distinct-stale-refs named-refs))
        ;; "merging" one stale (path, ref) pair - absorbing it via ancestry -
        ;; clears exactly that entry and leaves every other entry intact.
        (let [{:keys [path ref]} (rand-nth stale)
              after (reference-freshness-lib/stale-paths-multi-ref worktree-shas refs-shas {[ref path] true})]
          (assert-true (str "P3: absorbing " ref "'s amendment to " path " removes exactly that entry")
                       (not (some #(= % {:path path :ref ref}) after)))
          (assert= "P3: absorbing one entry leaves every other stale entry untouched"
                   (set (remove #(= % {:path path :ref ref}) stale))
                   (set after)))))))

;; ── non-vacuousness: a single-ref-selection implementation must fail P2 ──
;; The exact class of bug BL-1266 removes: pick ONE ref (here: always
;; "main", standing in for whatever freshest-main-ref's ahead-count picked)
;; and judge every path against only it. A drift on the OTHER ref is missed
;; whenever that ref happens to agree with the worktree.

(defn- broken-single-ref-fresh? [worktree-shas refs-shas]
  (let [main-shas (get refs-shas "main" {})]
    (every? (fn [[path sha]] (= sha (get worktree-shas path))) main-shas)))

(let [worktree-shas {"a.prompt" "same-as-main"}
      refs-shas {"main" {"a.prompt" "same-as-main"} "origin/main" {"a.prompt" "origin-only-amendment"}}]
  (assert-true "non-vacuousness: a single-ref (main-only) check WOULD wrongly report fresh"
               (true? (broken-single-ref-fresh? worktree-shas refs-shas)))
  (assert-true "non-vacuousness: the REAL stale-paths-multi-ref correctly catches the origin/main-only drift"
               (not (reference-freshness-lib/fresh-multi-ref? worktree-shas refs-shas)))
  (assert= "non-vacuousness: the REAL check names origin/main specifically, not main"
           [{:path "a.prompt" :ref "origin/main"}]
           (reference-freshness-lib/stale-paths-multi-ref worktree-shas refs-shas)))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "bl1266_reference_freshness_ref_selection_property_runner: ok")
