#!/usr/bin/env bb
;; BL-1272 property driver: the landed/unlanded reporting split and the land
;; step's action, driven through the REAL land_step_lib.bb.
;;
;; Two queries, both batched so a whole property run costs one bb process:
;;
;;   landed-batch '[{"paths":["a"],"complete":true,"same":[true]}, ...]'
;;     -> [bool, ...]      sibling-landed? over its injected facts (pure)
;;
;;   action-batch '[{"land":["BL-9002"]}, ...]'
;;     -> [{"action":str,"landed":[...],"unlanded":[...],"entangled":[...]},...]
;;     A REAL repository with a REAL bare origin per case: two sibling tickets
;;     and one own ticket on a linear branch, with the named subset of the
;;     siblings' content already landed on origin/main as different commit
;;     objects (what a tip-pure replay produces).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*))
                         ".." ".." ".." ".." "swarmforge" "scripts" "land_step_lib.bb")))

(defn- sh! [dir & args]
  (apply process/sh {:dir (str dir) :continue true} args))

(def siblings ["BL-9002" "BL-9003"])

(defn- build-case!
  "A fresh repo + bare origin. Returns {:root .. :commit ..}."
  [to-land]
  (let [work (str (fs/create-temp-dir {:prefix "bl1272-prop-"}))
        origin (str (fs/path work "origin.git"))
        root (str (fs/path work "repo"))]
    (sh! work "git" "init" "-q" "--bare" "-b" "main" origin)
    (sh! work "git" "init" "-q" "-b" "main" root)
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    (sh! root "git" "remote" "add" "origin" origin)
    (spit (str (fs/path root "base.txt")) "base\n")
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "seed the fixture")
    (sh! root "git" "push" "-q" "origin" "main")
    (doseq [s siblings]
      (spit (str (fs/path root (str s ".txt"))) (str s " work\n"))
      (sh! root "git" "add" "-A")
      (sh! root "git" "commit" "-q" "-m" (str s ": sibling work.")))
    (spit (str (fs/path root "own.txt")) "own\n")
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "BL-9001: own work.")
    (let [commit (str/trim (:out (sh! root "git" "rev-parse" "HEAD")))]
      (when (seq to-land)
        (let [lander (str (fs/path work "lander"))]
          (sh! work "git" "clone" "-q" origin lander)
          (sh! lander "git" "config" "user.email" "t@t")
          (sh! lander "git" "config" "user.name" "t")
          (sh! lander "git" "config" "commit.gpgsign" "false")
          (doseq [s to-land]
            (fs/copy (fs/path root (str s ".txt")) (fs/path lander (str s ".txt")) {:replace-existing true})
            (sh! lander "git" "add" "-A")
            (sh! lander "git" "commit" "-q" "-m" (str s ": sibling work (replayed tip-pure).")))
          (sh! lander "git" "push" "-q" "origin" "main")
          (sh! root "git" "fetch" "-q" "origin")))
      {:work work :root root :commit commit})))

(defn- action-case [{:keys [land]}]
  (let [{:keys [work root commit]} (build-case! land)]
    (try
      (let [plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
        {:action (name (:action plan))
         :entangled (vec (sort (:entangled plan)))
         :landed (vec (sort (:landed plan)))
         :unlanded (vec (sort (:unlanded plan)))})
      (finally (fs/delete-tree work)))))

(let [[query payload] *command-line-args*
      cases (json/parse-string (or payload "[]") true)]
  (case query
    "landed-batch"
    (println (json/generate-string
              (mapv (fn [{:keys [paths complete same]}]
                      (let [lookup (zipmap paths same)]
                        (land-step-lib/sibling-landed?
                         {:paths paths
                          :complete? complete
                          :same-content? #(boolean (get lookup %))})))
                    cases)))

    "action-batch"
    (println (json/generate-string (mapv action-case cases)))

    (do (binding [*out* *err*] (println "unknown query:" query))
        (System/exit 2))))
