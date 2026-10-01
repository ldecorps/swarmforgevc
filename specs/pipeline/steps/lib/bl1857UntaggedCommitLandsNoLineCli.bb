#!/usr/bin/env bb
;; BL-1857 acceptance driver: an untagged commit that lands no line of its
;; own never blocks a shared-path rebuild.
;;
;; Drives the REAL production entry point - swarmforge/scripts/land_step_cli.bb,
;; the CLI QA runs - over a REAL repository with a REAL origin/main ref, same
;; pattern as specs/pipeline/steps/lib/bl1830SharedOwnPathCli.bb (which this
;; fixture extends with an extra, untagged commit on the shared path): never
;; the pure land_step_lib.bb functions beneath it, so a driver that calls one
;; function cannot see it disagree with what the CLI actually prints and
;; commits.
;;
;; Usage: bl1857UntaggedCommitLandsNoLineCli.bb <shape>
;;   restore      an untagged commit restores the shared manifest to
;;                origin/main's exact content (undoing BL-9301's own row),
;;                and a later BL-9301 commit reapplies it - the real shape
;;                of a QA bounce restore followed by a reapply.
;;   add-remove   an untagged commit adds a transient row to the shared
;;                manifest; a LATER untagged commit removes that row again
;;                before the landing commit - net contribution is nothing.
;;   add-keep     an untagged commit adds a row that survives into the
;;                landing commit's own copy and origin/main never had -
;;                still refuses by name, unchanged (BL-1830 D1's own case).
;;
;; Prints one JSON line, same shape as bl1830SharedOwnPathCli.bb's:
;;   {"exit":N,"lines":[...],"reason":"...","rebuilt":[[path,sibling]],
;;    "manifestContent":"..."}

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/canonicalize (fs/path script-dir ".." ".." ".." "..")))
(def land-cli (str (fs/path repo-root "swarmforge" "scripts" "land_step_cli.bb")))

(def A "BL-9301")
(def U "BL-9302")
(def MANIFEST "swarmforge/scripts/test/suite-manifest.tsv")

(def FIXTURE-PREFIX "bl1857-acceptance-")

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
    (commit! root MANIFEST "existing_test.sh\tstanding\n" "seed the manifest")
    (mark-origin-main! root)
    (commit! root MANIFEST
             "existing_test.sh\tstanding\ntest_bl9301.sh\tstanding\n"
             (str A ": add its own test to the manifest"))
    (case shape
      "restore"
      (do
        (commit! root MANIFEST "existing_test.sh\tstanding\n"
                 "Restore bounced parcel paths to origin/main content.")
        (commit! root MANIFEST
                 "existing_test.sh\tstanding\ntest_bl9301.sh\tstanding\n"
                 (str A ": reapply its own row after restore"))
        (commit! root MANIFEST
                 "existing_test.sh\tstanding\ntest_bl9301.sh\tstanding\ntest_bl9302.sh\tstanding\n"
                 (str U ": add its own test to the manifest")))

      "add-remove"
      (do
        (commit! root MANIFEST
                 "existing_test.sh\tstanding\ntest_bl9301.sh\tstanding\ntest_scratch.sh\tstanding\n"
                 "Re-point scratch pass: add a transient row")
        (commit! root MANIFEST
                 "existing_test.sh\tstanding\ntest_bl9301.sh\tstanding\n"
                 "Re-point scratch pass: drop the transient row")
        (commit! root MANIFEST
                 "existing_test.sh\tstanding\ntest_bl9301.sh\tstanding\ntest_bl9302.sh\tstanding\n"
                 (str U ": add its own test to the manifest")))

      "add-keep"
      (do
        (commit! root MANIFEST
                 "existing_test.sh\tstanding\ntest_bl9301.sh\tstanding\ntest_bl9302.sh\tstanding\n"
                 (str U ": add its own test to the manifest"))
        (commit! root MANIFEST
                 "existing_test.sh\tstanding\ntest_bl9301.sh\tstanding\ntest_bl9302.sh\tstanding\ntest_untracked_by_anyone.sh\tstanding\n"
                 "Restore bounced-ticket paths to origin/main after re-point.")))
    ;; U's own ticket, unlanded and approved - never blocking, but never
    ;; closed either, so its lines are never an ordinary passenger's to
    ;; carry whole (BL-1830's own reach, same posture here).
    (commit! root (str "backlog/active/" U "-sibling.yaml")
             (str "id: " U "\nstatus: todo\nhuman_approval: approved\n")
             (str U ": the sibling's ticket"))
    ;; A's own ticket file, always.
    (commit! root (str "backlog/active/" A "-own.yaml")
             (str "id: " A "\nstatus: todo\n")
             (str A ": own ticket file"))
    {:work work :root root :commit (head root)}))

(defn- lines-of [prefix out]
  (->> (str/split-lines out)
       (filter #(str/starts-with? % (str prefix " ")))
       (map #(str/split (subs % (inc (count prefix))) #"\s+"))
       vec))

(defn- escalate-reason
  "The land's own reason is the LAST line main-land prints before exiting 1
   (main-land's own order: LAND_ESCALATE, then optional entanglement lines,
   then `(:reason plan)` last) - never re-derived by scanning for a marker
   string that reason text might itself happen to contain."
  [res]
  (when (= 1 (:exit res))
    (last (remove str/blank? (str/split-lines (:out res))))))

(defn- blob-at-or-nil [root rev path]
  (let [res (sh! root "git" "show" (str rev ":" path))]
    (when (zero? (:exit res)) (:out res))))

(defn- run [shape]
  (sweep-fixtures!)
  (let [{:keys [work root commit]} (build! shape)]
    (try
      (let [res (sh! root "bb" land-cli (str A "-fixture-task") commit root)
            out (str (:out res) "\n" (:err res))
            replay-line (first (filter #(str/starts-with? % "LAND_REPLAY ") (str/split-lines out)))
            replayed-commit (when replay-line (last (str/split replay-line #"\s+")))]
        (println (json/generate-string
                  {:exit (:exit res)
                   :lines (vec (remove str/blank? (str/split-lines out)))
                   :reason (escalate-reason res)
                   :rebuilt (lines-of "SHARED_OWN_PATH_REBUILT" out)
                   :manifestContent (when replayed-commit (blob-at-or-nil root replayed-commit MANIFEST))})))
      (finally (fs/delete-tree work)))))

(let [[shape] *command-line-args*]
  (when (str/blank? shape)
    (binding [*out* *err*] (println "usage: bl1857UntaggedCommitLandsNoLineCli.bb <shape>"))
    (System/exit 2))
  (run shape))
