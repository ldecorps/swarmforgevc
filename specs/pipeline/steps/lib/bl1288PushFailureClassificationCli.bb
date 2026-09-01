#!/usr/bin/env bb
;; BL-1288 acceptance driver: calls master_main_reconcile_lib.bb's real
;; rematch-with-push-first! against a REAL git repo with the REAL
;; :push!/:reset! adapters (`git push origin main` / `git reset --hard
;; origin/main`) - the same adapter shape swarm_heal.bb wires, and the same
;; technique as this ticket's predecessor driver, bl1198RematchPushFirstCli.bb.
;;
;; The difference that matters here: nothing about the push failure is
;; simulated. The caller (bl1288PushFailureClassificationSteps.js) points
;; `origin` at a remote that produces the real cause under test - a diverged
;; bare repo for a rejection, an unresolvable host for an unreachable remote,
;; a BatchMode ssh URL for an absent credential - and git's own stderr is what
;; reaches push-rejection?. A fixture stderr string would test the classifier
;; against the coder's idea of what git prints; this tests it against what git
;; actually prints.
;;
;; The reset adapter is real too, so "the local-ahead commits are kept" is
;; observed as HEAD still being the commit the caller made, not inferred from
;; a flag. headBefore/headAfter are reported for exactly that reason.
;;
;; BL-1310: :reset! is wrapped with master_main_reconcile_lib.bb's own
;; refuse-reset-if-local-ahead! - the same composition the three production
;; call sites wire - so every row with local-ahead commits proves current
;; behaviour (kept/refused), not the pre-BL-1310 discard path.
;;
;; Usage: bb bl1288PushFailureClassificationCli.bb <repo-root>
;; Exits 0 always (the push/reset failing is the subject, not an error);
;; prints one JSON line to stdout.
(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "master_main_reconcile_lib.bb")))

(def root (first *command-line-args*))
(when-not root
  (binding [*out* *err*] (println "usage: bl1288PushFailureClassificationCli.bb <repo-root>"))
  (System/exit 2))

(defn sh [& args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str root) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn head [] (:out (sh "git" "rev-parse" "HEAD")))

;; The production callers all fetch before deciding to reset, so `origin/main`
;; is current when :reset! reads it. Mirrored here for the same reason
;; bl1198RematchPushFirstCli.bb mirrors it: without this, a reset would land
;; on a stale cached tip rather than origin's real one. Allowed to fail - on
;; the unreachable and no-credential causes it cannot succeed, and its failure
;; changes nothing: the push that follows fails for the same reason, which is
;; the input under test.

(sh "git" "fetch" "origin" "main")

(def head-before (head))
(def reset-attempted? (atom false))

(def reset-adapters
  (master-main-reconcile-lib/real-git-reset-adapters
   {:sh! sh :reset-attempted? reset-attempted?}))

(def result
  (master-main-reconcile-lib/rematch-with-push-first!
   {:push! (fn []
             (let [r (sh "git" "push" "origin" "main")]
               {:success (zero? (:exit r)) :error (:err r)}))
    :reset! (fn []
              (master-main-reconcile-lib/refuse-reset-if-local-ahead! reset-adapters))}))

(println (json/generate-string
          {:pushed (= :pushed (:outcome result))
           :resetAttempted @reset-attempted?
           :outcome (some-> (:outcome result) name)
           :error (:error result)
           :headBefore head-before
           :headAfter (head)}))
(System/exit 0)
