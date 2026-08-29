;; BL-640: pre-turn guard - a role must never silently act while its own
;; worktree's swarmforge/constitution/articles/reference/ elaboration has
;; drifted from main's. Mechanism bound by the specifier 2026-08-18 to
;; option 1 (freshness check at stage start): compare each reference/ file's
;; content against main's and, when any differs, refuse the turn and report
;; which files are stale - this guard never attempts a merge itself (BL-924
;; owns the untracked hot-synced-copy defect that can block one; this
;; guard's outcome must not depend on a merge succeeding, per BL-640's own
;; out_of_scope). Pure decision logic only - ready_for_next.bb wires this to
;; real git + sha256, the same pure/IO split as branch_claim_guard_lib.bb.
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "reference_freshness_lib.bb")))
;; and referred to as reference-freshness-lib/foo.

(ns reference-freshness-lib
  (:require [clojure.string :as str])
  (:import [java.security MessageDigest]))

(def reference-dir-rel "swarmforge/constitution/articles/reference")

(defn sha256-hex [s]
  (let [digest (-> (MessageDigest/getInstance "SHA-256")
                    (.digest (.getBytes (or s "") "UTF-8")))]
    (apply str (map #(format "%02x" %) digest))))

(defn stale-paths
  "worktree-shas / main-shas: {rel-path -> content-sha256-hex}. Returns the
   sorted vector of rel-paths present in main-shas whose content the
   worktree does not carry byte-identical (a differing sha, or a path
   missing from worktree-shas entirely) - the amendment drift a role has
   not yet merged. A path present only in worktree-shas (deleted upstream,
   or worktree-local scratch) is never reported - it is not the
   amendment-delivery gap this invariant is about."
  [worktree-shas main-shas]
  (->> main-shas
       (keep (fn [[path sha]] (when (not= sha (get worktree-shas path)) path)))
       sort
       vec))

(defn fresh?
  [worktree-shas main-shas]
  (empty? (stale-paths worktree-shas main-shas)))

(defn staleness-report
  "Refusal text naming every stale path and the fix. paths must be
   non-empty - callers only invoke this once fresh? is already false."
  [paths]
  (str "STALE_REFERENCE_ELABORATION: this worktree has not merged an amendment to the "
       "following " reference-dir-rel " file(s) - an inlined constitution rule and its "
       "on-demand elaboration could contradict each other until `main` is merged:\n"
       (str/join "\n" (map #(str "  - " %) paths))
       "\nMerge main, then run ready_for_next.sh again."))
