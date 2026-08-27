;; BL-973: the transitive load-file closure of a bb entry point, computed from
;; source. The Babashka-side twin of specs/pipeline/steps/lib/
;; operatorRuntimeBbClosure.js (BL-944), which shell fixtures cannot reach -
;; they cannot require a Node module, and hand-maintaining the list instead is
;; the defect this ticket exists to remove.
;;
;; Five fixture copy-lists named a script's dependencies by hand with nothing
;; gating them, and they drifted three times: BL-911 added prompt_engine_lib.bb
;; to handoff_lib.bb's closure, BL-967 added daemon_cycle_guard_lib.bb, BL-1029
;; added shell_quote_lib.bb. Each time, two acceptance features and a shell test
;; went red - the shell test unnoticed for days, because no standing gate ran it.
;;
;; BL-897: this is a second implementation of a rule the JS side also encodes,
;; across a language boundary no import can bridge. A "kept in sync" comment is
;; not a gate, so swarmforge/scripts/test/bb_load_closure_agreement_test_runner.bb
;; asserts the two agree on every entry point the fixtures actually use. Change
;; one and that test fails; that is the point.
;;
;; Every load-file form in this codebase resolves relative to the LOADING file's
;; own directory via the identical idiom:
;;   (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "NAME.bb")))
;; and every .bb file involved lives flat under swarmforge/scripts/, so the walk
;; needs no path resolution beyond that one root.

(ns bb-load-closure-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def ^:private load-file-re #"(?s)\(load-file\b.*?\"([^\"]+\.bb)\"")

(defn direct-load-file-deps
  "Pure: the .bb filenames one file's source load-files directly. No recursion,
   no I/O. Mirrors operatorRuntimeBbClosure.js's directLoadFileDeps."
  [source-text]
  (mapv second (re-seq load-file-re (or source-text ""))))

(defn compute-closure
  "The transitive closure of entry-file within scripts-dir - every .bb it
   load-files, and everything THEY load-file. Returns a set INCLUDING the entry
   file itself, matching the JS twin and the existing copy-lists' own
   convention. A dependency that is not on disk is still returned (so a caller
   can report it as a real gap) but is not walked further."
  [scripts-dir entry-file]
  (loop [closure #{entry-file}
         queue [entry-file]]
    (if-let [file (first queue)]
      (let [full (fs/path scripts-dir file)
            deps (if (fs/exists? full)
                   (direct-load-file-deps (slurp (str full)))
                   [])
            fresh (remove closure deps)]
        (recur (into closure fresh) (into (vec (rest queue)) fresh)))
      closure)))

(defn diff-closure-against-list
  "{:missing [...] :extra [...]} - missing: closure members absent from the
   maintained list, which is invariant 1's violation shape; extra: listed names
   the closure never reaches and that are not declared exceptions. Both sorted,
   for stable output. Mirrors the JS twin's diffClosureAgainstList."
  [scripts-dir entry-file maintained-list declared-extras]
  (let [closure (compute-closure scripts-dir entry-file)
        listed (set maintained-list)
        declared (set declared-extras)]
    {:missing (vec (sort (remove listed closure)))
     :extra (vec (sort (remove #(or (closure %) (declared %)) listed)))
     :closure closure}))

(defn format-closure
  "One filename per line, sorted - the shape a shell fixture consumes with a
   `while read` loop."
  [closure]
  (str/join "\n" (sort closure)))
