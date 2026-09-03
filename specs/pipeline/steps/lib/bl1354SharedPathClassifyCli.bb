#!/usr/bin/env bb
;; BL-1354 acceptance driver: the landed/unlanded split when a path carries
;; lines from more than one sibling, driven through the REAL land_step_lib.bb.
;;
;; Two queries, both printing one JSON line {"landed":[...],"unlanded":[...]}:
;;
;;   classify <landed-first?>   A REAL repository with a REAL origin/main. One
;;                              shared file carries a line from each of two
;;                              sibling tickets; each also has a private file.
;;                              When <landed-first?>, the FIRST sibling's own
;;                              lines are replayed onto origin/main tip-pure (a
;;                              different commit object), leaving the second's
;;                              absent - which is the whole shape of the
;;                              defect: the shared file's blob still differs,
;;                              so whole-blob equality calls both unlanded.
;;
;;   attribution <kind>         The unanswered rows (walk-failed, empty-path-
;;                              set, unreadable-diff). The first two inject
;;                              landed-siblings' own paths-fn seam; the third
;;                              deletes the sibling commit's tree object so the
;;                              REAL diff cannot be computed.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*))
                         ".." ".." ".." ".." "swarmforge" "scripts" "land_step_lib.bb")))

(def FIRST "BL-9302")
(def SECOND "BL-9303")
(def OWN "BL-9301")
(def SHARED "shared.md")

(defn- sh! [dir & args]
  (apply process/sh {:dir (str dir) :continue true} args))

(defn- commit! [root path content message]
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- head [root] (str/trim (:out (sh! root "git" "rev-parse" "HEAD"))))

(defn- mark-origin-main! [root]
  (sh! root "git" "update-ref" "refs/remotes/origin/main" (head root)))

(defn- build!
  "{:work .. :root .. :commit ..}. `land-first?` replays the FIRST sibling's
   own lines onto origin/main as a different commit object."
  [land-first?]
  (let [work (str (fs/create-temp-dir {:prefix "bl1354-acceptance-"}))
        root (str (fs/path work "repo"))]
    (fs/create-dirs root)
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    (commit! root SHARED "base line\n" "seed the shared file")
    (mark-origin-main! root)
    (let [base (head root)]
      (commit! root SHARED (str "base line\n" FIRST " line\n") (str FIRST ": first sibling's work"))
      (commit! root (str FIRST ".md") "first sibling private\n" (str FIRST ": first sibling's own file"))
      (commit! root SHARED (str "base line\n" FIRST " line\n" SECOND " line\n")
               (str SECOND ": second sibling's work"))
      (commit! root (str SECOND ".md") "second sibling private\n" (str SECOND ": second sibling's own file"))
      (commit! root "own.md" "own\n" (str OWN ": the landing ticket's own work"))
      (let [commit (head root)]
        (when land-first?
          (sh! root "git" "checkout" "-q" "-b" "landing" base)
          (commit! root SHARED (str "base line\n" FIRST " line\n")
                   (str FIRST ": first sibling's work (replayed tip-pure)"))
          (commit! root (str FIRST ".md") "first sibling private\n"
                   (str FIRST ": first sibling's own file (replayed tip-pure)"))
          (mark-origin-main! root)
          (sh! root "git" "checkout" "-q" "main"))
        {:work work :root root :commit commit}))))

(defn- report [landed siblings]
  {:landed (vec (sort landed))
   :unlanded (vec (sort (remove landed siblings)))})

(defn- classify [land-first?]
  (let [{:keys [work root commit]} (build! land-first?)]
    (try
      (let [{:keys [landed unlanded]} (land-step-lib/entangled-siblings root commit OWN)]
        {:landed (vec (sort landed)) :unlanded (vec (sort unlanded))})
      (finally (fs/delete-tree work)))))

(defn- attribution [kind]
  (let [{:keys [work root commit]} (build! true)]
    (try
      (let [origin-main (land-step-lib/origin-main-sha root)
            candidates (str/split-lines
                        (str/trim (:out (sh! root "git" "rev-list" (str origin-main ".." commit)))))
            siblings #{FIRST SECOND}]
        (case kind
          "a walk that failed"
          (report (land-step-lib/landed-siblings root commit origin-main candidates siblings
                                                 (constantly nil))
                  siblings)

          "an empty path set"
          (report (land-step-lib/landed-siblings root commit origin-main candidates siblings
                                                 (constantly []))
                  siblings)

          "an unreadable diff"
          ;; The FIRST sibling's own diff can no longer be computed: its tree
          ;; object is gone, so the question cannot be answered - and an
          ;; unanswered question never answers "landed".
          (let [sib-commit (str/trim (:out (sh! root "git" "log" "--format=%H" "-1"
                                                (str "--grep=^" FIRST ":") commit)))
                tree (str/trim (:out (sh! root "git" "rev-parse" (str sib-commit "^{tree}"))))]
            (fs/delete (fs/path root ".git" "objects" (subs tree 0 2) (subs tree 2)))
            (let [{:keys [landed unlanded]} (land-step-lib/entangled-siblings root commit OWN)]
              {:landed (vec (sort (or landed []))) :unlanded (vec (sort (or unlanded siblings)))}))

          (throw (ex-info (str "unknown attribution kind: " kind) {}))))
      (finally (fs/delete-tree work)))))

(let [[query payload] *command-line-args*]
  (case query
    "classify" (println (json/generate-string (classify (= "true" payload))))
    "attribution" (println (json/generate-string (attribution payload)))
    (do (binding [*out* *err*] (println "unknown query:" query))
        (System/exit 2))))
