;; BL-2049: which property runners under swarmforge/scripts/test a set of
;; changed paths reaches - the selector BL-2048's front-end runs with
;; --changed-from so a parcel's own pass sweeps only the runners its own
;; change could have broken, never all 217 (the 2026-10-06 census: the
;; first 88 alone took 20 minutes on the swarm host).
;;
;; A runner R is reached by a changed path P under swarmforge/scripts/
;; when: P is R itself; or R is a .bb and P is a .bb in R's load-file
;; closure; or R's own text contains P's file name (a script R spawns, a
;; lib R copies into a fixture - 28 of the 211 .bb runners load-file
;; nothing and reach their code only this way). A path outside
;; swarmforge/scripts/ reaches nothing.

(ns property-runner-reach-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "bb_load_closure_lib.bb")))

(def ^:private runner-name-re #"_property_runner\.(bb|sh|js)$")

(defn list-runners
  "Every *_property_runner.{bb,sh,js} file NAME (no directory) directly in
   scripts-dir/test, sorted - the same population run_property_runners.sh
   itself lists."
  [scripts-dir]
  (let [test-dir (fs/path scripts-dir "test")]
    (if (fs/directory? test-dir)
      (->> (fs/list-dir test-dir)
           (filter #(and (fs/regular-file? %) (re-find runner-name-re (fs/file-name %))))
           (map fs/file-name)
           sort
           vec)
      [])))

;; A load-file dep string (e.g. "../a.bb", "lib/x.bb") is relative to the
;; LOADING file's own directory (every real .bb file's own idiom) - here,
;; always scripts-dir/test, since this is only ever called on a runner's
;; own direct deps. Returns the dep's path relative to scripts-dir, the
;; one root compute-closure needs every hop resolved against.
(defn- first-hop-rel-to-scripts-dir [scripts-dir dep]
  (let [test-dir (fs/path scripts-dir "test")
        abs (fs/path test-dir dep)]
    (str (fs/relativize (fs/path scripts-dir) abs))))

(defn runner-bb-closure
  "The full set of .bb files (paths relative to scripts-dir, INCLUDING each
   of R's own first-hop deps) a .bb runner R - living in scripts-dir/test -
   reaches by load-file. compute-closure cannot be called on R itself: it
   resolves every dependency against the ONE root it is given, so from
   scripts-dir it cannot follow a dep written as \"../a.bb\" (relative to
   scripts-dir/test), and from scripts-dir/test it would list a.bb's own
   deps but never walk them (a.bb's OWN load-file forms are relative to
   scripts-dir, not scripts-dir/test) - measured against
   bl2039_tier_aware_chase_sweep_property_runner.bb. R's own direct deps
   are therefore resolved against ITS directory first, then each one is
   walked with compute-closure rooted at scripts-dir, where every REAL
   .bb lib's own load-file forms actually resolve correctly."
  [scripts-dir runner-name]
  (let [runner-path (fs/path scripts-dir "test" runner-name)
        text (slurp (str runner-path))
        direct-deps (bb-load-closure-lib/direct-load-file-deps text)
        first-hops (map #(first-hop-rel-to-scripts-dir scripts-dir %) direct-deps)]
    (reduce
     (fn [acc hop] (into acc (bb-load-closure-lib/compute-closure scripts-dir hop)))
     #{}
     first-hops)))

;; Invariant 1: a runner this cannot read, or whose closure it cannot
;; compute, is reported REACHED, never dropped - the whole rule-1/2/3
;; check for one (runner, path) pair is wrapped in one try/catch, so any
;; failure anywhere in it (an unreadable runner file, a malformed
;; load-file form, anything) answers true rather than silently false.
(defn runner-reached-by-path?
  [scripts-dir repo-root runner-name changed-path]
  (try
    (let [changed-abs (str (fs/path repo-root changed-path))
          runner-abs (str (fs/path scripts-dir "test" runner-name))]
      (boolean
       (or
        (= changed-abs runner-abs)
        (and (str/ends-with? runner-name ".bb")
             (let [closure (runner-bb-closure scripts-dir runner-name)
                   closure-abs (into #{} (map #(str (fs/path scripts-dir %))) closure)]
               (contains? closure-abs changed-abs)))
        (str/includes? (slurp runner-abs) (fs/file-name changed-abs)))))
    (catch Exception _ true)))

(defn- under-scripts-dir? [scripts-dir repo-root changed-path]
  (let [abs (str (fs/path repo-root changed-path))
        prefix (str (fs/path scripts-dir) (System/getProperty "file.separator"))]
    (str/starts-with? abs prefix)))

(defn reached-runners
  "Runner file names (sorted) reached by ANY of changed-paths (each
   relative to the repository root, scripts-dir/../..). Invariant 2: the
   runners reached by several paths are exactly the union of what each
   path reaches alone - this computes it literally that way (one pass per
   path, unioned), never a combined shortcut that could drop one path's
   own reach."
  [scripts-dir changed-paths]
  (let [scripts-dir (str (fs/path scripts-dir))
        repo-root (str (fs/parent (fs/parent (fs/path scripts-dir))))
        runners (list-runners scripts-dir)
        relevant (filter #(under-scripts-dir? scripts-dir repo-root %) changed-paths)]
    (->> runners
         (filter (fn [r] (some #(runner-reached-by-path? scripts-dir repo-root r %) relevant)))
         sort
         vec)))
