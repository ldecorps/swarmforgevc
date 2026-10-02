#!/usr/bin/env bb
;; BL-1872: QA's queue command - its last act on an approved parcel.
;;
;; Usage: lander_queue.bb <project-root> --enqueue <task> <approved-commit> [<issue-ref>]
;;
;; Writes one entry under <project-root>/.swarmforge/lander/queue/ and returns.
;; It fetches, builds and pushes nothing: handoffd's lander sweep runs the land
;; (lander_lib.bb). The commit is resolved read-only to its full sha; the same
;; task and commit queued again is the same entry.
;;
;; Prints LANDER_QUEUED <id> or LANDER_ALREADY_QUEUED <id>; exit 2 on a usage
;; error or a commit that does not resolve.

(require '[babashka.fs :as fs]
         '[clojure.java.shell :as sh]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "lander_lib.bb")))

(defn- fail! [msg]
  (binding [*out* *err*] (println msg))
  (System/exit 2))

(defn -main [[root mode task commit issue]]
  (when-not (and root (= "--enqueue" mode) task commit)
    (fail! "usage: lander_queue.bb <project-root> --enqueue <task> <approved-commit> [<issue-ref>]"))
  (let [r (sh/sh "git" "-C" root "rev-parse" "-q" "--verify" (str commit "^{commit}"))
        full (str/trim (:out r))]
    (when-not (zero? (:exit r))
      (fail! (str "lander_queue.bb: " commit " is not a commit in " root)))
    (let [{:keys [result id]} (lander-lib/enqueue! (str (fs/absolutize root)) task full issue (System/currentTimeMillis))]
      (println (str (if (= :queued result) "LANDER_QUEUED " "LANDER_ALREADY_QUEUED ") id)))))

(-main *command-line-args*)
