;; BL-111: pure logic for migrate_gherkin_to_features.bb, split out so it is
;; directly testable without triggering a real migration run (constitution
;; testability boundary - mirrors mutation_cooldown_lib.bb's split from its
;; own thin CLI wrapper). Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "migrate_gherkin_to_features_lib.bb")))
;; and referred to as migrate-gherkin-to-features-lib/foo.
(ns migrate-gherkin-to-features-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(defn indent-of [line]
  (count (take-while #(= % \space) line)))

(defn acceptance-block-line-index
  "Index of the `acceptance:` key line, or nil if this ticket has none. Only
   matches a block-scalar form (`acceptance: |` / `acceptance: |-`) - an
   already-migrated ticket's single-line `acceptance: specs/features/...`
   reference does not match, so re-running the migration treats it as
   nothing to migrate (idempotent)."
  [lines]
  (first (keep-indexed (fn [i l] (when (re-matches #"^acceptance:\s*\|-?\s*$" l) i)) lines)))

(defn block-end-index
  "First index AFTER the acceptance: key line whose line is non-blank and
   at or below column 0 (the next top-level YAML key) - the standard rule
   for where a block scalar under a top-level key ends."
  [lines start-idx]
  (or (first (keep-indexed
              (fn [i l] (when (and (> i start-idx) (not (str/blank? l)) (zero? (indent-of l))) i))
              lines))
      (count lines)))

(defn strip-common-indent
  "Removes the block scalar's own leading indentation (2 spaces in every
   ticket observed) from each line, leaving blank lines untouched."
  [block-lines]
  (map (fn [l] (if (str/blank? l) "" (subs l (min 2 (count l))))) block-lines))

(defn feature-name-from-block [block-text]
  (some->> (str/split-lines block-text)
           (some #(re-matches #"\s*Feature:\s*(.+)" %))
           second))

(defn migrate-file!
  [yaml-path features-dir]
  (let [content (slurp (str yaml-path))
        lines (str/split-lines content)
        start-idx (acceptance-block-line-index lines)]
    (if (nil? start-idx)
      (println "SKIP (no acceptance: field):" (str yaml-path))
      (let [end-idx (block-end-index lines start-idx)
            block-lines (subvec (vec lines) (inc start-idx) end-idx)
            feature-text (str (str/join "\n" (strip-common-indent block-lines)) "\n")
            feature-name (feature-name-from-block feature-text)
            slug (-> (fs/file-name yaml-path) (str/replace #"\.yaml$" ""))
            feature-filename (str slug ".feature")
            feature-path (fs/path features-dir feature-filename)
            reference-line (str "acceptance: specs/features/" feature-filename)
            new-lines (concat (subvec (vec lines) 0 start-idx)
                               [reference-line]
                               (subvec (vec lines) end-idx))]
        (fs/create-dirs features-dir)
        (spit (str feature-path) feature-text)
        (spit (str yaml-path) (str (str/join "\n" new-lines) "\n"))
        (println "MIGRATED:" (str yaml-path) "->" (str feature-path) (str "(" (or feature-name "?") ")"))))))

(defn backlog-yaml-files [repo-root dir]
  (let [d (fs/path repo-root "backlog" dir)]
    (if (fs/exists? d)
      (->> (fs/list-dir d)
           (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".yaml")))
           sort)
      [])))

(defn run-migration!
  "done/ items are never touched - the feature file becomes the durable
   acceptance contract, the backlog item is not. A ticket with no
   acceptance: field (a stub/epic with no concrete Gherkin yet) is left
   alone entirely via migrate-file!'s own SKIP path."
  [repo-root]
  (let [features-dir (fs/path repo-root "specs" "features")]
    (doseq [yaml-path (concat (backlog-yaml-files repo-root "active") (backlog-yaml-files repo-root "paused"))]
      (migrate-file! yaml-path features-dir))))
