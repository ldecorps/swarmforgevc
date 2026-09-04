#!/usr/bin/env bb
;; BL-1389 acceptance driver: a path an unlanded sibling owns ALONE never rides
;; another ticket's land.
;;
;; Drives the REAL production entry point - swarmforge/scripts/land_step_cli.bb,
;; the CLI QA runs - over a REAL repository with a REAL origin/main ref, and
;; reports what that CLI printed plus what its replayed commit actually
;; contains. Never land_step_lib.bb's pure functions: the defect this ticket
;; exists for is a decision made against a verdict computed elsewhere, and a
;; driver that calls one function cannot see the two disagree.
;;
;; Usage: bl1389UnlandedSiblingPathCli.bb <shape>
;;   base        origin/main holds the sibling's feature file; the tip carries
;;               the sibling's handler and source under sibling-tagged commits
;;               and the landing ticket's own files
;;   approved    base, plus the sibling's ticket file reads human_approval:
;;               approved
;;   shared      approved, plus one path BOTH tickets changed
;;   all-landed  base, but origin/main also holds the sibling's handler and
;;               source with the sibling's own lines
;;
;; Prints one JSON line:
;;   {"exit":N,"lines":[...],"entangled":[...],"landed":[[id,path]],
;;    "excluded":[[path,owner]],"passengers":[...],"replayPaths":[...]}

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/canonicalize (fs/path script-dir ".." ".." ".." "..")))
(def land-cli (str (fs/path repo-root "swarmforge" "scripts" "land_step_cli.bb")))

(def SIB "BL-9002")
(def OWN "BL-9001")
(def FEATURE (str "specs/features/" SIB "-sibling.feature"))
(def HANDLER (str "specs/pipeline/steps/" SIB "SiblingSteps.js"))
(def SOURCE (str "extension/src/" SIB "-sibling.ts"))
(def OWN-FILE (str "backlog/active/" OWN "-own.yaml"))
(def SHARED "docs/reference/shared.md")

(def FIXTURE-PREFIX "bl1389-acceptance-")

(defn- sweep-fixtures!
  "A killed run traps no `finally`, so a leftover fixture from a previous run is
   removed by PREFIX before this one starts as well (BL-971). Safe here for the
   reason it is not safe in a production guard: these roots are this test's
   own, one run at a time."
  []
  (doseq [d (fs/list-dir (fs/temp-dir))
          :when (str/starts-with? (fs/file-name d) FIXTURE-PREFIX)]
    (try (fs/delete-tree d) (catch Exception _ nil))))

(defn- sh! [dir & args]
  (apply process/sh {:dir (str dir) :continue true} args))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- head [root] (str/trim (:out (sh! root "git" "rev-parse" "HEAD"))))

(defn- mark-origin-main! [root]
  (sh! root "git" "update-ref" "refs/remotes/origin/main" (head root)))

(defn- build!
  "{:work .. :root .. :commit ..}"
  [shape]
  (let [work (str (fs/create-temp-dir {:prefix FIXTURE-PREFIX}))
        root (str (fs/path work "repo"))]
    (fs/create-dirs root)
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    ;; origin/main: the sibling's feature file, minted at spec time and landed
    ;; long before its pipeline work - the landed path that used to carry the
    ;; whole ticket-level verdict.
    (commit! root FEATURE (str "Feature: " SIB " sibling\n") (str SIB ": mint the feature file"))
    ;; The feature file's own registered handler lands with it. Not decoration:
    ;; the land step runs check_feature_handler_registration.sh against the
    ;; replayed tree, and a fixture whose origin/main carries a feature nothing
    ;; handles would be refused for a reason this ticket is not about.
    (commit! root "specs/pipeline/steps/index.js"
             "const DOMAINS = [\n  require('./BL-9002FeatureSteps'),\n];\nmodule.exports = { DOMAINS };\n"
             (str SIB ": register the feature's handler"))
    (commit! root "specs/pipeline/steps/BL-9002FeatureSteps.js"
             "'use strict';\nfunction registerSteps() {}\nmodule.exports = { registerSteps };\n"
             (str SIB ": the feature's own handler"))
    (when (= shape "shared")
      (commit! root SHARED "base line\n" "seed the shared reference"))
    (mark-origin-main! root)
    (let [base (head root)]
      ;; The tip: the sibling's own pipeline work, under sibling-tagged
      ;; commits, none of it on origin/main.
      (commit! root HANDLER (str "// " SIB " handler\n") (str SIB ": the sibling's step handler"))
      (commit! root SOURCE (str "export const sibling = '" SIB "';\n") (str SIB ": the sibling's source"))
      (when (contains? #{"approved" "shared"} shape)
        (commit! root (str "backlog/active/" SIB "-sibling.yaml")
                 (str "id: " SIB "\nstatus: todo\nhuman_approval: approved\n")
                 (str SIB ": the sibling's ticket")))
      (when (= shape "shared")
        (commit! root SHARED (str "base line\n" SIB " line\n") (str SIB ": the sibling edits the shared reference")))
      ;; The landing ticket's own work.
      (commit! root OWN-FILE (str "id: " OWN "\nstatus: todo\n") (str OWN ": the landing ticket's own file"))
      (when (= shape "shared")
        (commit! root SHARED (str "base line\n" SIB " line\n" OWN " line\n")
                 (str OWN ": the landing ticket edits the shared reference")))
      (let [commit (head root)]
        (when (= shape "all-landed")
          ;; origin/main gains the sibling's handler and source, with the
          ;; sibling's OWN lines, as different commit objects - the shape of a
          ;; sibling that landed through its own tip-pure replay.
          (sh! root "git" "checkout" "-q" "-b" "landing" base)
          (commit! root HANDLER (str "// " SIB " handler\n") (str SIB ": the sibling's step handler (replayed)"))
          (commit! root SOURCE (str "export const sibling = '" SIB "';\n") (str SIB ": the sibling's source (replayed)"))
          (mark-origin-main! root)
          (sh! root "git" "checkout" "-q" "main"))
        {:work work :root root :commit commit}))))

(defn- lines-of [prefix out]
  (->> (str/split-lines out)
       (filter #(str/starts-with? % (str prefix " ")))
       (map #(str/split (subs % (inc (count prefix))) #"\s+"))
       vec))

(defn- replay-paths [root out]
  (when-let [line (first (filter #(str/starts-with? % "LAND_REPLAY ") (str/split-lines out)))]
    (let [replayed (last (str/split line #"\s+"))
          om (str/trim (:out (sh! root "git" "rev-parse" "refs/remotes/origin/main")))
          diff (sh! root "git" "diff" "--name-only" om replayed)]
      (when (zero? (:exit diff))
        (vec (remove str/blank? (str/split-lines (:out diff))))))))

(defn- run [shape]
  (sweep-fixtures!)
  (let [{:keys [work root commit]} (build! shape)]
    (try
      (let [res (sh! root "bb" land-cli (str OWN "-fixture-task") commit root)
            out (str (:out res) "\n" (:err res))]
        (println (json/generate-string
                  {:exit (:exit res)
                   :lines (vec (remove str/blank? (str/split-lines out)))
                   :entangled (mapv first (lines-of "ENTANGLED_SIBLING" out))
                   :landed (lines-of "LANDED_SIBLING" out)
                   :excluded (lines-of "EXCLUDED_SIBLING_PATH" out)
                   :passengers (mapv first (lines-of "PASSENGER_SIBLING" out))
                   :replayPaths (or (replay-paths root out) [])})))
      (finally (fs/delete-tree work)))))

(let [[shape] *command-line-args*]
  (when (str/blank? shape)
    (binding [*out* *err*] (println "usage: bl1389UnlandedSiblingPathCli.bb <shape>"))
    (System/exit 2))
  (run shape))
