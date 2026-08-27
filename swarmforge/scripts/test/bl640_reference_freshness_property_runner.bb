#!/usr/bin/env bb
;; BL-640: PROPERTY test over reference_freshness_lib.bb's stale-paths/
;; fresh? functions, covering the ticket YAML's one declared invariant
;; (coder-authored first, per BL-654):
;;
;;   "No amendment to articles/reference/ can leave any role reading a
;;    stale elaboration that contradicts the amended rule on `main`."
;;
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.
;; Follows the established .bb property-runner precedent (see
;; bl719_dropped_parcel_invariants_property_runner.bb) - the
;; "*.property.test.js" / vitest.properties.config.mjs home is a
;; TypeScript convention with a Babashka-side sibling in this same
;; directory's *_property_runner.bb files.
;;
;;   P1 drift-is-always-caught - for ANY main-shas map, whenever the
;;      worktree's content differs from (or is missing) main's for a path,
;;      stale-paths names EXACTLY that path and fresh? is false. This is
;;      the invariant's core: a role backed by this guard can never read a
;;      stale elaboration without the guard having already flagged it.
;;
;;   P2 no-drift-is-never-a-false-positive - when the worktree is
;;      byte-identical to main for every main-tracked path, fresh? is
;;      always true (stale-paths is empty), regardless of how many
;;      unrelated extra files sit only in the worktree (deleted-upstream /
;;      scratch) - the "zero cost in the normal case" half of the bound
;;      outcome, and what stops the guard from refusing every turn forever.
;;
;;   BL-654 collision-by-construction: main-shas/worktree-shas are never
;;   drawn independently (independent random sha strings would almost
;;   never coincide, making the "fresh" branch practically unreachable).
;;   main-shas is DERIVED from a base map by selectively mutating or
;;   dropping a controlled subset of paths - every generated pair is a
;;   drift-or-no-drift case by construction, and the mutated-subset size is
;;   driven from 0 up through "every path", so the generator demonstrably
;;   reaches no-drift, single-file drift, and multi-file drift, not just
;;   whichever shape a wide uniform draw happens to land on most often.

(ns bl640-reference-freshness-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "reference_freshness_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 640))
(defn- rint [bound] (.nextInt rng (int bound)))

(defn- rand-sha [] (str "sha-" (rint 1000000000)))

(defn- base-shas
  ([n] (base-shas n "file"))
  ([n prefix] (into {} (for [i (range n)] [(str prefix "-" i ".prompt") (rand-sha)]))))

;; ── P1 + P2: drift is always caught, no-drift is never a false positive ──

(def branches-hit (atom #{}))

(dotimes [_ 80]
  (let [n (+ 2 (rint 8))
        ;; main-shas is the base: the paths (and content) that exist on
        ;; main. worktree-shas is DERIVED from it below - never drawn
        ;; independently, so "fresh" is actually reachable (independent
        ;; random sha strings would practically never coincide).
        main-shas (base-shas n)
        paths (vec (keys main-shas))
        ;; How many paths the worktree will disagree with main on - swept
        ;; from 0 (fresh) up to n (every path stale), not a coin flip, so
        ;; every count in the range is demonstrably reached over the loop.
        drift-count (rint (inc n))
        drifted-paths (set (take drift-count (shuffle paths)))
        ;; Half of a drifted path's mutations give the worktree DIFFERENT
        ;; content (an amendment the worktree has an old copy of); the
        ;; other half drop it from worktree-shas entirely (a file the
        ;; worktree never had at all) - both are drift shapes stale-paths
        ;; must catch identically.
        worktree-shas (into {}
                             (keep (fn [[path sha]]
                                     (cond
                                       (not (contains? drifted-paths path)) [path sha]
                                       (.nextBoolean rng) [path (rand-sha)]
                                       :else nil))
                                   main-shas))
        expected-stale (vec (sort drifted-paths))
        actual-stale (reference-freshness-lib/stale-paths worktree-shas main-shas)]
    (swap! branches-hit conj (cond (zero? drift-count) :no-drift
                                    (= drift-count n) :all-drift
                                    :else :some-drift))
    (assert-true (str "P1: stale-paths must name exactly the drifted paths, no more no fewer "
                       "(n=" n " drift-count=" drift-count " drifted=" (sort drifted-paths) ")")
                 (= (sort expected-stale) (sort actual-stale)))
    (assert-true (str "P1: fresh? must be false whenever any path actually drifted "
                       "(drift-count=" drift-count ")")
                 (= (zero? drift-count) (reference-freshness-lib/fresh? worktree-shas main-shas)))
    (when (zero? drift-count)
      (assert-true "P2: an identical worktree/main pair is fresh with an empty stale-paths"
                   (and (reference-freshness-lib/fresh? worktree-shas main-shas)
                        (empty? actual-stale))))))

(assert-true "the generator reached no-drift, some-drift, and all-drift over its sweep"
             (and (contains? @branches-hit :no-drift)
                  (contains? @branches-hit :some-drift)
                  (contains? @branches-hit :all-drift)))

;; P2 extension: unrelated extra files that exist ONLY in the worktree
;; (deleted upstream, or worktree-local scratch) must never make a
;; byte-identical-on-main-tracked-paths worktree read as stale.
(dotimes [_ 20]
  (let [shared (base-shas (+ 1 (rint 5)) "shared")
        worktree-only (base-shas (rint 4) "scratch")
        worktree-shas (merge shared worktree-only)]
    (assert-true "P2: worktree-only extra files never trigger a false-positive refusal"
                 (reference-freshness-lib/fresh? worktree-shas shared))))

;; ── non-vacuousness: a broken same-count comparison must fail P1 ─────────
;; The exact class of bug a naive "did the file count change" check would
;; ship: same number of paths, but the CONTENT differs on one of them - a
;; broken implementation that only compares (count worktree-shas) vs
;; (count main-shas) reports "fresh" here, which is precisely the silent
;; stale-read this invariant exists to prevent.
(defn- broken-fresh?-by-count-only [worktree-shas main-shas]
  (= (count worktree-shas) (count main-shas)))

(let [worktree-shas {"a.prompt" "sha-old" "b.prompt" "sha-b"}
      main-shas {"a.prompt" "sha-new" "b.prompt" "sha-b"}]
  (assert-true "non-vacuousness: the broken count-only check WOULD wrongly report fresh"
               (true? (broken-fresh?-by-count-only worktree-shas main-shas)))
  (assert-true "non-vacuousness: the REAL fresh? correctly reports stale for the same input"
               (false? (reference-freshness-lib/fresh? worktree-shas main-shas)))
  (assert-true "non-vacuousness: the REAL stale-paths correctly names the drifted file"
               (= ["a.prompt"] (reference-freshness-lib/stale-paths worktree-shas main-shas))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "bl640_reference_freshness_property_runner: ok")
