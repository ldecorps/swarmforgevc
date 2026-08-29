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
  "worktree-shas / main-shas: {rel-path -> content-sha256-hex}.
   worktree-has-main-amendment?: {rel-path -> boolean}, for each path whose
   content differs - BL-1237: whether the worktree already contains (as an
   ancestor of its own HEAD) main's most recent commit touching that path.
   true means the differing content is the worktree's OWN newer work on
   top of an amendment it has already absorbed - allow (invariant 1: never
   refuse for content the worktree carries that main does not yet have).
   A path absent from this map (the caller had no ancestry answer, or this
   call predates BL-1237) defaults to false - fail closed, preserving
   BL-640's original refuse-on-any-difference behavior for the case this
   ticket does not touch: content the worktree is genuinely MISSING.

   Returns the sorted vector of rel-paths present in main-shas whose
   content the worktree does not carry byte-identical AND has not already
   absorbed via ancestry - the amendment drift a role has not yet merged.
   A path present only in worktree-shas (deleted upstream, or worktree-
   local scratch) is never reported - it is not the amendment-delivery gap
   this invariant is about."
  ([worktree-shas main-shas] (stale-paths worktree-shas main-shas {}))
  ([worktree-shas main-shas worktree-has-main-amendment?]
   (->> main-shas
        (keep (fn [[path sha]]
                (when (and (not= sha (get worktree-shas path))
                           (not (get worktree-has-main-amendment? path false)))
                  path)))
        sort
        vec)))

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

;; BL-1266: freshest-main-ref picked ONE ref by comparing whole-repo
;; ahead-counts, then asked every path about that single ref - a bad pick
;; (the higher-counting ref can still be BEHIND on any one path) is
;; inherited rather than caught. The question is per path, so it is asked
;; per path, of every ref that carries the reference dir.

(defn stale-paths-multi-ref
  "worktree-shas: {rel-path -> sha}.
   refs-shas: {ref-name -> {rel-path -> sha}} - one map per ref that carries
   the reference dir at HEAD (e.g. {\"main\" {...}, \"origin/main\" {...}}).
   worktree-has-ref-amendment?: {[ref-name rel-path] -> boolean} - BL-1237's
   ancestry answer, now keyed per (ref, path): does the worktree's own HEAD
   already contain that ref's most recent commit touching that path? A pair
   absent from this map defaults to false - fail closed, refuse.

   Returns the sorted vector of {:path rel-path :ref ref-name} entries for
   every (path, ref) combination where the worktree's content differs from
   that ref's copy AND has not already been absorbed via ancestry from that
   same ref. A path is fresh only once EVERY ref that carries it is
   satisfied - two refs disagreeing on a path never lets one satisfied ref
   excuse the other being missing (invariant 2). A path present in a ref
   but absent from worktree-shas entirely is reported the same as a
   content mismatch - never merged at all."
  ([worktree-shas refs-shas] (stale-paths-multi-ref worktree-shas refs-shas {}))
  ([worktree-shas refs-shas worktree-has-ref-amendment?]
   (->> (for [[ref shas] refs-shas
              [path sha] shas
              :when (and (not= sha (get worktree-shas path))
                         (not (get worktree-has-ref-amendment? [ref path] false)))]
          {:path path :ref ref})
        (sort-by (juxt :path :ref))
        vec)))

(defn fresh-multi-ref?
  [worktree-shas refs-shas]
  (empty? (stale-paths-multi-ref worktree-shas refs-shas)))

(defn staleness-report-multi-ref
  "Refusal text for stale-paths-multi-ref's output - a vector of
   {:path :ref} entries, non-empty. Names every stale path together with
   the SPECIFIC ref whose amendment it is missing (invariant 3), and a
   remedy that merges exactly the refs actually needed - merging a ref
   this worktree was never missing content from is not the fix."
  [stale]
  (let [refs (->> stale (map :ref) distinct sort)]
    (str "STALE_REFERENCE_ELABORATION: this worktree has not merged an amendment to the "
         "following " reference-dir-rel " file(s) - an inlined constitution rule and its "
         "on-demand elaboration could contradict each other until the named ref is merged:\n"
         (str/join "\n" (map (fn [{:keys [path ref]}] (str "  - " path " (missing " ref "'s amendment)")) stale))
         "\nMerge " (str/join " and " refs) ", then run ready_for_next.sh again.")))
