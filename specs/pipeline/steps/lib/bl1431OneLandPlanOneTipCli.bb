#!/usr/bin/env bb
;; BL-1431 acceptance driver: one land-step invocation reads one origin/main
;; tip, immune to main moving mid-walk. Drives the REAL land_step_lib.bb
;; functions (never a reimplementation) against a real fixture repository
;; with a real bare origin.
;;
;; Usage: bl1431OneLandPlanOneTipCli.bb <mode>
;;   moving-tip     scenario 01: origin/main advances mid-walk via the
;;                  library's own path-attributing-commits seam; the plan
;;                  must equal the same plan computed with origin held still.
;;   resolved-once  scenario 02: counts real calls to origin-main-sha during
;;                  one land-plan invocation against an entangled fixture.
;;   no-origin      scenario 03: no origin/main ref at all; land-plan must
;;                  fail open, never guessing a SHA.
;;   moved-at-push  scenario 04: the plan produces a replay commit, origin/
;;                  main then advances by an unrelated mint, and
;;                  land_main_publish.sh publishes through exactly one
;;                  rematch.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/canonicalize (fs/path script-dir ".." ".." ".." "..")))
(load-file (str (fs/path repo-root "swarmforge" "scripts" "land_step_lib.bb")))
(def land-main-publish (str (fs/path repo-root "swarmforge" "scripts" "land_main_publish.sh")))

(def SIB "BL-9002")
(def OWN "BL-9001")
(def FEATURE (str "specs/features/" SIB "-sibling.feature"))
(def HANDLER (str "specs/pipeline/steps/" SIB "SiblingSteps.js"))
(def SOURCE (str "extension/src/" SIB "-sibling.ts"))
(def OWN-FILE (str "backlog/active/" OWN "-own.yaml"))

(def FIXTURE-PREFIX "bl1431-acceptance-")

(defn- sweep-fixtures!
  "BL-971: a killed run traps no `finally`, so a leftover from a previous run
   is removed by PREFIX before this one starts too - safe here because every
   root under this prefix is this test's own, one run at a time."
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

(defn- clone-and-configure!
  "A fresh `git clone` inherits no config - `commit!` against it fails
   silently with 'Author identity unknown' otherwise (measured live
   authoring this driver: the mint commit never happened, so the push
   after it advanced nothing, and the scenario this drives never actually
   raced anything)."
  [bare dest]
  (sh! (fs/parent dest) "git" "clone" "-q" bare dest)
  (sh! dest "git" "config" "user.email" "t@t")
  (sh! dest "git" "config" "user.name" "t")
  (sh! dest "git" "config" "commit.gpgsign" "false"))

;; A REAL bare origin (never a self-remote): scenario 01's wrapper pushes to
;; it mid-walk and scenario 04's publish step pushes to it too, so both need
;; a genuine second repository a fetch actually moves against.
(defn- build!
  "{:work .. :root .. :bare .. :commit ..} - an entangled tip (an unlanded,
   approved sibling ticket's own commits as ancestors, mirroring BL-1389's
   own fixture shape) so land-plan's decision is :replay, giving every
   scenario a real walk to move a ref underneath."
  []
  (let [work (str (fs/create-temp-dir {:prefix FIXTURE-PREFIX}))
        bare (str (fs/path work "origin.git"))
        root (str (fs/path work "repo"))]
    (sh! work "git" "init" "-q" "--bare" bare)
    ;; Without this, a bare repo's default HEAD symref stays whatever git's
    ;; own init.defaultBranch says (often "master"), so a later `git clone`
    ;; of it checks out THAT branch, not "main" - and a clone's own `git
    ;; push origin main` then fails with "src refspec main does not match
    ;; any" (reproduced live authoring this driver), silently never
    ;; advancing origin/main at all.
    (sh! work "git" "-C" bare "symbolic-ref" "HEAD" "refs/heads/main")
    (fs/create-dirs root)
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    (sh! root "git" "remote" "add" "origin" bare)
    (commit! root FEATURE (str "Feature: " SIB " sibling\n") (str SIB ": mint the feature file"))
    (commit! root "specs/pipeline/steps/index.js"
             "const DOMAINS = [\n  require('./BL-9002FeatureSteps'),\n];\nmodule.exports = { DOMAINS };\n"
             (str SIB ": register the feature's handler"))
    (commit! root "specs/pipeline/steps/BL-9002FeatureSteps.js"
             "'use strict';\nfunction registerSteps() {}\nmodule.exports = { registerSteps };\n"
             (str SIB ": the feature's own handler"))
    (sh! root "git" "push" "-q" "origin" "main")
    (sh! root "git" "fetch" "-q" "origin" "main")
    (commit! root HANDLER (str "// " SIB " handler\n") (str SIB ": the sibling's step handler"))
    (commit! root SOURCE (str "export const sibling = '" SIB "';\n") (str SIB ": the sibling's source"))
    (commit! root (str "backlog/active/" SIB "-sibling.yaml")
             (str "id: " SIB "\nstatus: todo\nhuman_approval: approved\n")
             (str SIB ": the sibling's ticket"))
    (commit! root OWN-FILE (str "id: " OWN "\nstatus: todo\n") (str OWN ": the landing ticket's own file"))
    {:work work :root root :bare bare :commit (head root)}))

(defn- comparable-plan
  "Strips nothing that should differ between two independently built (but
   content-identical) fixtures - land-plan's own output is already expressed
   in ticket ids and paths, never raw SHAs, so no scrubbing is needed. Sets
   are sorted for a stable equality/printed comparison."
  [plan]
  (-> plan
      (update :entangled #(some-> % sort vec))
      (update :landed #(some-> % sort vec))
      (update :unlanded #(some-> % sort vec))
      (update :passengers #(some-> % sort vec))
      (update :own-paths #(some-> % sort vec))
      (update :excluded #(some->> % (sort-by :path) vec))))

(defn- run-moving-tip []
  (sweep-fixtures!)
  (let [f1 (build!)
        plan-still (land-step-lib/land-plan {:root (:root f1) :commit (:commit f1) :task-ticket-id OWN
                                              :origin-main (land-step-lib/origin-main-sha (:root f1))})
        f2 (build!)
        moved? (atom false)
        real-path-attributing-commits land-step-lib/path-attributing-commits
        moving-fn (fn [r om c path]
                    (when (compare-and-set! moved? false true)
                      ;; An unrelated mint commit lands on the SEPARATE bare
                      ;; origin f2 pushes to, then f2's own checkout fetches
                      ;; it - origin/main genuinely moves under the walk that
                      ;; is already running against the SHA it started with.
                      (let [side (str (fs/path (:work f2) "side"))]
                        (clone-and-configure! (:bare f2) side)
                        (commit! side "backlog/active/BL-9099-mint.yaml" "id: BL-9099\n" "BL-9099: mint mid-walk")
                        (sh! side "git" "push" "-q" "origin" "main"))
                      (sh! (:root f2) "git" "fetch" "-q" "origin" "main"))
                    (real-path-attributing-commits r om c path))
        plan-moving (with-redefs [land-step-lib/path-attributing-commits moving-fn]
                      (land-step-lib/land-plan {:root (:root f2) :commit (:commit f2) :task-ticket-id OWN
                                                 :origin-main (land-step-lib/origin-main-sha (:root f2))}))
        unreadable? (or (str/includes? (str (:warning plan-moving)) "could not read")
                        (str/includes? (str (:reason plan-moving)) "could not read"))]
    (try
      (println (json/generate-string
                {:equal (= (comparable-plan plan-still) (comparable-plan plan-moving))
                 :planStill (comparable-plan plan-still)
                 :planMoving (comparable-plan plan-moving)
                 :anyPathUnreadable unreadable?
                 :originMoved @moved?}))
      (finally
        (fs/delete-tree (:work f1))
        (fs/delete-tree (:work f2))))))

(defn- run-resolved-once []
  (sweep-fixtures!)
  (let [{:keys [work root commit]} (build!)
        call-count (atom 0)
        real land-step-lib/origin-main-sha
        counting-fn (fn [r] (swap! call-count inc) (real r))]
    (try
      ;; No :origin-main key passed - land-plan resolves it itself, exactly
      ;; once, at its own entry (invariant 1's "direct callers... resolve
      ;; once themselves at their own entry" half).
      (let [plan (with-redefs [land-step-lib/origin-main-sha counting-fn]
                   (land-step-lib/land-plan {:root root :commit commit :task-ticket-id OWN}))]
        (println (json/generate-string
                  {:callCount @call-count
                   :action (name (:action plan))
                   :entangled (vec (sort (or (:entangled plan) [])))})))
      (finally (fs/delete-tree work)))))

(defn- run-no-origin []
  (sweep-fixtures!)
  (let [work (str (fs/create-temp-dir {:prefix FIXTURE-PREFIX}))
        root (str (fs/path work "repo"))]
    (fs/create-dirs root)
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    ;; No `origin` remote at all, so origin/main cannot resolve.
    (commit! root OWN-FILE (str "id: " OWN "\nstatus: todo\n") (str OWN ": the landing ticket's own file"))
    (try
      (let [commit (head root)
            plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id OWN})]
        (println (json/generate-string
                  {:action (name (:action plan))
                   :reason (:reason plan)})))
      (finally (fs/delete-tree work)))))

(defn- run-moved-at-push []
  (sweep-fixtures!)
  (let [{:keys [work root bare commit]} (build!)
        origin-main (land-step-lib/origin-main-sha root)
        plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id OWN :origin-main origin-main})]
    (try
      (if-not (= :replay (:action plan))
        (println (json/generate-string {:error (str "fixture did not produce a replay plan: " (pr-str plan))}))
        (let [replay (land-step-lib/replay! {:root root :commit commit :task-ticket-id OWN
                                              :own-paths (:own-paths plan) :passengers (:passengers plan)
                                              :origin-main origin-main})]
          (if-not (:success replay)
            (println (json/generate-string {:error (str "fixture replay failed: " (:reason replay))}))
            (do
              ;; origin/main advances by an unrelated mint AFTER the plan was
              ;; computed and the replay built, before the push.
              (let [side (str (fs/path work "side"))]
                (clone-and-configure! bare side)
                (commit! side "backlog/active/BL-9099-mint.yaml" "id: BL-9099\n" "BL-9099: mint after the plan")
                (sh! side "git" "push" "-q" "origin" "main"))
              (let [publish (sh! root "bash" land-main-publish root "--land" (str OWN "-fixture-task")
                                  (:commit replay))
                    out (str (:out publish) "\n" (:err publish))
                    rematch-count (count (re-seq #"(?m)^LAND_REMATCH" out))
                    published? (str/includes? out "LAND_PUBLISHED")
                    ;; A structural check on the SCRIPT's own CODE lines, not
                    ;; the runtime log or its comments: land_main_publish.sh's
                    ;; "LAND_REMATCH: ... never --force." message and a
                    ;; header comment both legitimately contain the substring
                    ;; "--force" in prose alongside the word "push" on the
                    ;; same line, so grepping either the output or the raw
                    ;; source text for that pair would report "forced" on
                    ;; every ordinary rematch or every read of the file. The
                    ;; actual guarantee is that no CODE line (comments and
                    ;; blanks stripped) ever constructs a `git push` with a
                    ;; force flag.
                    code-lines (remove #(re-matches #"^\s*(#.*)?$" %)
                                       (str/split-lines (slurp land-main-publish)))
                    forced? (boolean (some #(re-find #"git.*push.*(-f\b|--force)" %) code-lines))]
                (println (json/generate-string
                          {:exit (:exit publish)
                           :rematchCount rematch-count
                           :published published?
                           :forced forced?
                           :lines (vec (remove str/blank? (str/split-lines out)))})))))))
      (finally (fs/delete-tree work)))))

(let [[mode] *command-line-args*]
  (case mode
    "moving-tip" (run-moving-tip)
    "resolved-once" (run-resolved-once)
    "no-origin" (run-no-origin)
    "moved-at-push" (run-moved-at-push)
    (do (binding [*out* *err*] (println "usage: bl1431OneLandPlanOneTipCli.bb <moving-tip|resolved-once|no-origin|moved-at-push>"))
        (System/exit 2))))
