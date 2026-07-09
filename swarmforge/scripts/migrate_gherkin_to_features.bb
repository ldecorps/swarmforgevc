#!/usr/bin/env bb
;; BL-111 feature-migration-01: migrates the inline Gherkin `acceptance: |`
;; block of every backlog/active/ and backlog/paused/ item into its own
;; .feature file under specs/features/, then replaces the YAML's
;; acceptance: field with a path reference to it. done/ items are never
;; touched - the feature file becomes the durable acceptance contract, the
;; backlog item is not.
;;
;; A ticket with no acceptance: field (a stub/epic with no concrete Gherkin
;; yet) is left alone entirely - there is nothing to migrate.
;;
;; This is a targeted TEXT transformation, not a full YAML parse/dump: only
;; the acceptance: block's line range is touched, so every other field
;; (id, title, description, notes, mutation_cost, comments, formatting)
;; passes through completely unchanged.
;;
;; Usage: migrate_gherkin_to_features.bb <repo-root>

(ns migrate-gherkin-to-features
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def repo-root (or (first *command-line-args*)
                    (do (binding [*out* *err*] (println "Usage: migrate_gherkin_to_features.bb <repo-root>"))
                        (System/exit 1))))

(def features-dir (fs/path repo-root "specs" "features"))

(defn indent-of [line]
  (count (take-while #(= % \space) line)))

(defn acceptance-block-line-index
  "Index of the `acceptance:` key line, or nil if this ticket has none."
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

(defn migrate-file! [yaml-path]
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

(defn backlog-yaml-files [dir]
  (let [d (fs/path repo-root "backlog" dir)]
    (if (fs/exists? d)
      (->> (fs/list-dir d)
           (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".yaml")))
           sort)
      [])))

(defn -main []
  (doseq [yaml-path (concat (backlog-yaml-files "active") (backlog-yaml-files "paused"))]
    (migrate-file! yaml-path)))

(-main)
