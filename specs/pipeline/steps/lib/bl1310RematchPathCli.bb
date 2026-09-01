#!/usr/bin/env bb
;; BL-1310 acceptance driver, scenario 03 only ("A reconcile with nothing
;; local-ahead may still reset after rejection" - the ahead=0 case this
;; ticket's fix must leave unaffected). Calls master_main_reconcile_lib.bb's
;; real rematch-with-push-first! against a REAL git repo, with a REAL
;; :push! adapter and a REAL :reset! adapter GATED exactly the way
;; handoffd.bb's own refuse-reset-if-local-ahead! gates it (:3188) - the
;; ahead-count is read fresh, right before the reset would fire, via the
;; same `git rev-list --left-right --count origin/main...main` handoffd.bb's
;; master-main-local-ahead-count! runs, and only a KNOWN ahead=0 proceeds to
;; the real `git reset --hard origin/main`. This is deliberately the SAME
;; adapter shape bl1198RematchPushFirstCli.bb already established (that
;; ticket's own driver, unmodified, has no BL-1310 gate at all - reusing it
;; here would prove nothing about this ticket's fix).
;;
;; Usage: bb bl1310RematchPathCli.bb <repo-root>
;; Exits 0 always; prints one JSON line
;; {"pushed":bool,"pushAttempted":bool,"resetAttempted":bool,"resetRefused":bool}.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "master_main_reconcile_lib.bb")))

(def root (first *command-line-args*))
(when-not root
  (binding [*out* *err*] (println "usage: bl1310RematchPathCli.bb <repo-root>"))
  (System/exit 2))

(defn sh [& args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str root) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

;; The production caller always fetches before deciding to reset, so
;; origin/main's remote-tracking ref is current when the ahead-count and
;; :reset! read it. Mirrored here, same reason bl1198RematchPushFirstCli.bb
;; mirrors it.
(sh "git" "fetch" "origin" "main")

(def push-attempted? (atom false))
(def reset-attempted? (atom false))
(def reset-refused? (atom false))

;; BL-1310: local main's ahead-count against origin/main, read fresh - the
;; same real git command handoffd.bb's master-main-local-ahead-count! runs.
(defn ahead-count! []
  (let [r (sh "git" "rev-list" "--left-right" "--count" "origin/main...main")]
    (when (zero? (:exit r))
      (let [[_behind ahead] (map parse-long (str/split (:out r) #"\s+"))]
        ahead))))

(def result
  (master-main-reconcile-lib/rematch-with-push-first!
   {:push! (fn []
             (reset! push-attempted? true)
             (let [r (sh "git" "push" "origin" "main")]
               {:success (zero? (:exit r)) :error (:err r)}))
    :reset! (fn []
              (let [ahead (ahead-count!)]
                (if (master-main-reconcile-lib/reset-authorized-by-ahead-count? ahead)
                  (do (reset! reset-attempted? true)
                      (let [r (sh "git" "reset" "--hard" "origin/main")]
                        {:success (zero? (:exit r)) :error (:err r)}))
                  (do (reset! reset-refused? true)
                      {:success false :outcome :local-ahead-refused
                       :error (str "BL-1310: local-ahead commits present (ahead="
                                   (or ahead "undeterminable") ") - refused")}))))}))

(println (json/generate-string {:pushed (= :pushed (:outcome result))
                                 :pushAttempted @push-attempted?
                                 :resetAttempted @reset-attempted?
                                 :resetRefused @reset-refused?}))
(System/exit 0)
