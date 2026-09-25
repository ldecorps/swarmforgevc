#!/usr/bin/env bb
;; BL-1717 acceptance driver: a landed co-owner never shields an unlanded
;; sibling's lines on the same path.
;;
;; Drives the REAL production entry point - swarmforge/scripts/land_step_cli.bb,
;; the CLI QA runs - over a REAL repository with a REAL origin/main ref, and
;; reports what that CLI printed plus what its replayed commit actually
;; contains. Mirrors specs/pipeline/steps/lib/bl1389UnlandedSiblingPathCli.bb's
;; own pattern (the "all-landed" shape): the sibling's own lines are given a
;; SEPARATE presence on origin/main, under a different commit object, proving
;; land-plan's REAL ticket-level and per-path landed reads, not a stub.
;;
;; Usage: bl1717LandedCoOwnerCli.bb <shape>
;;   not-shared  landed ticket L and unlanded approved ticket U both changed
;;               path P (L's own lines also separately on origin/main, under
;;               a different commit - L reads landed); landing ticket A
;;               changed only its own path Q
;;   shared      not-shared, plus A's own commit also changes P
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

(def L "BL-9201")
(def U "BL-9202")
(def A "BL-9203")
(def P "docs/reference/BL-1717-shared.md")
(def Q (str "backlog/active/" A "-own.yaml"))

(def FIXTURE-PREFIX "bl1717-acceptance-")

(defn- sweep-fixtures!
  "A killed run traps no `finally`, so a leftover fixture from a previous run is
   removed by PREFIX before this one starts as well (BL-971)."
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
    (commit! root "README.md" "fixture root\n" "seed")
    ;; check_feature_handler_registration.sh (a tree guard replay! always
    ;; runs) requires a readable specs/pipeline/steps/index.js - empty
    ;; DOMAINS is a valid registry when the fixture adds no .feature file.
    (commit! root "specs/pipeline/steps/index.js"
             "const DOMAINS = [];\nmodule.exports = { DOMAINS };\n"
             "seed the step registry")
    (mark-origin-main! root)
    (let [base (head root)]
      ;; L's own commit on P - its own lines, tagged L.
      (commit! root P "L line\n" (str L ": touch the shared path"))
      ;; U's commit ADDS to P, on top of L's - its own lines not yet
      ;; anywhere on origin/main, tagged U.
      (commit! root P "L line\nU line\n" (str U ": touch the shared path"))
      (when (= shape "shared")
        (commit! root (str "backlog/active/" U "-sibling.yaml")
                 (str "id: " U "\nstatus: todo\nhuman_approval: approved\n")
                 (str U ": the sibling's ticket")))
      ;; A's own work: its own path Q, always.
      (commit! root Q (str "id: " A "\nstatus: todo\n") (str A ": the landing ticket's own file"))
      (when (= shape "shared")
        ;; A also changes P - the shared-path scenario (02).
        (commit! root P "L line\nU line\nA line\n" (str A ": also touch the shared path")))
      (let [commit (head root)]
        ;; L's own lines, and ONLY L's, given a separate presence on
        ;; origin/main under a different commit object - the "landed
        ;; elsewhere, under a different sha" shape BL-1389's own
        ;; all-landed fixture and BL-1481's own incident both use.
        ;; sibling-own-line-changes/sibling-path-landed-fn compares L's
        ;; own added lines against this, so L reads landed on P while U's
        ;; line is absent from origin/main.
        (sh! root "git" "checkout" "-q" "-b" "landing" base)
        (commit! root P "L line\n" (str L ": touch the shared path (replayed)"))
        (mark-origin-main! root)
        (sh! root "git" "checkout" "-q" "main")
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
      (let [res (sh! root "bb" land-cli (str A "-fixture-task") commit root)
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
    (binding [*out* *err*] (println "usage: bl1717LandedCoOwnerCli.bb <shape>"))
    (System/exit 2))
  (run shape))
