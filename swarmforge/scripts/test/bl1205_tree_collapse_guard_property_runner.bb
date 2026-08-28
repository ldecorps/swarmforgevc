#!/usr/bin/env bb
;; BL-1205 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over tree_collapse_guard_lib.bb, encoding the
;; ticket's declared invariants.
;;
;;   invariant 1 - "Every git_handoff is evaluated by the guard, whatever
;;      role it is addressed to - no hop is exempt, and no ticket id is
;;      required for a finding": encoded structurally by
;;      findings-for-git-handoff never taking a task-name/ticket-id
;;      parameter at all (its call signature is root/recipients/commit
;;      only) - a generative property over mass-deletion? itself covers
;;      the actual gating math this invariant depends on for every
;;      recipient shape, independent of any ticket context.
;;
;;   invariant 3 - "A guard that cannot read what it needs warns and lets
;;      the send through - only a positive finding blocks": mass-deletion?
;;      itself requires `before > 0`, so an unreadable-branch shape
;;      (nowhere for `before` to come from) can never reach a true
;;      verdict through this function - encoded generatively below,
;;      non-zero `before` only reachable via a real fs read the pure
;;      function never performs itself.
;;
;;   invariant 2 ("the guard only ever refuses; it never alters, rewrites,
;;      or reverts the commit it is refusing") is NOT encoded here: it
;;      quantifies over the guard's own I/O surface (findings-for-git-
;;      handoff issues read-only `ls-tree`/`merge-tree --write-tree` git
;;      subcommands, never `merge`, `commit`, `reset`, or `push`), not over
;;      mass-deletion?'s pure input space - asserted instead by grepping
;;      this lib's own source for any write-shaped git subcommand, below.
;;
;; The threshold math itself (removed > min(5% of before, 100)) is
;; generatively fuzzed here: random (before, removed) pairs, comparing
;; mass-deletion? against an independently-restated oracle.
;;
;; Non-vacuity proven by hand at authoring time: relaxing mass-deletion? to
;; use ONLY the flat 100-path cap (dropping the 5% branch) fails the
;; property on its first generated small-branch case where 5% is the
;; tighter bound; relaxing it to ignore `before <= 0` fails on its first
;; zero-before case. Both restored before landing.

(ns bl1205-tree-collapse-guard-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tree_collapse_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 2000))
(def failures (atom []))
(def ^:private rng (java.util.Random. 1205))
(defn- rint [n] (.nextInt rng (int n)))

;; ── threshold math, generatively ─────────────────────────────────────────

(defn expected-mass-deletion? [{:keys [before removed]}]
  (boolean (and (pos? before) (pos? removed)
                (> removed (min (* tree-collapse-guard-lib/threshold-fraction before)
                                 tree-collapse-guard-lib/threshold-absolute)))))

(def refusing-cases-reached (atom 0))
(def small-branch-5pct-tighter-reached (atom 0))

(dotimes [_ runs]
  (let [before (inc (rint 20000))
        removed (rint (inc before))
        scenario {:before before :removed removed}
        expected (expected-mass-deletion? scenario)
        actual (tree-collapse-guard-lib/mass-deletion? scenario)]
    (when expected (swap! refusing-cases-reached inc))
    (when (and (< (* tree-collapse-guard-lib/threshold-fraction before) tree-collapse-guard-lib/threshold-absolute)
               (> removed (* tree-collapse-guard-lib/threshold-fraction before))
               (<= removed tree-collapse-guard-lib/threshold-absolute))
      (swap! small-branch-5pct-tighter-reached inc))
    (when (not= expected actual)
      (swap! failures conj (str "FAIL: expected " expected " got " actual " for " (pr-str scenario))))))

(when (zero? @refusing-cases-reached)
  (swap! failures conj "FAIL reachability: a genuinely refusing scenario never generated"))
(when (zero? @small-branch-5pct-tighter-reached)
  (swap! failures conj "FAIL reachability: the '5% is the tighter bound' shape never generated"))

;; ── invariant 3 (partial, direct): before <= 0 never refuses ─────────────

(when (tree-collapse-guard-lib/mass-deletion? {:before 0 :removed 500})
  (swap! failures conj "FAIL invariant 3: before=0 (nothing readable) was still flagged as a finding"))
(when (tree-collapse-guard-lib/mass-deletion? {:before -5 :removed 500})
  (swap! failures conj "FAIL invariant 3: negative before was still flagged as a finding"))

;; ── invariant 2: the guard's own source issues no write-shaped git call ──

(let [src (slurp (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tree_collapse_guard_lib.bb")))]
  (doseq [write-verb ["\"merge\"" "\"commit\"" "\"reset\"" "\"push\"" "\"checkout\"" "\"rebase\""]]
    (when (str/includes? src write-verb)
      (swap! failures conj (str "FAIL invariant 2: tree_collapse_guard_lib.bb's source names a write-shaped git verb " write-verb)))))

;; ── report ───────────────────────────────────────────────────────────────

(println (str "tree_collapse_guard_lib property: " runs " runs"))
(if (seq @failures)
  (do (doseq [f (take 10 @failures)] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
