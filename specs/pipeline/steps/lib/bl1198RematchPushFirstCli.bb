#!/usr/bin/env bb
;; BL-1198 acceptance driver: calls master_main_reconcile_lib.bb's real
;; rematch-with-push-first! against a REAL git repo, with REAL :push!/:reset!
;; adapters (git push origin main / git reset --hard origin/main) - the
;; exact same adapter shape swarm_heal.bb wires (swarm_heal.bb:93-98). This
;; bypasses the higher-level heal!/handoffd :should-reconcile decision layer
;; deliberately: that layer only calls :rematch! once behind>0, at which
;; point a same-call-window push is structurally rejected regardless of the
;; fix (see test_swarm_heal_push_before_reset.sh's header comment for the
;; full trace) - it cannot discriminate the fix and is out of this ticket's
;; scope ("Redesigning when a rematch/reset is TRIGGERED" is explicitly
;; out_of_scope). Driving rematch-with-push-first! directly is what actually
;; exercises "only what happens immediately before a reset that has already
;; been decided on fires" - the ticket's own in-scope description.
;;
;; BL-1310: :reset! is wrapped with master_main_reconcile_lib.bb's own
;; refuse-reset-if-local-ahead! - the same composition handoffd.bb,
;; swarm_heal.bb, and post_hotfix_merge_origin.bb wire at their reset
;; adapters - so scenario 02 proves current production behaviour for
;; local-ahead commits, not the pre-BL-1310 discard path.
;;
;; Usage: bb bl1198RematchPushFirstCli.bb <repo-root>
;; Exits 0 always (success/failure of the push/reset themselves is not this
;; script's concern); prints one JSON line
;; {"pushed":bool,"pushAttempted":bool,"resetAttempted":bool} to stdout -
;; pushed/pushAttempted from rematch-with-push-first!'s own outcome, and
;; resetAttempted from a call-tracking wrapper (same technique as
;; master_main_reconcile_lib_property_runner.bb's push-before-reset-
;; violation) so "no reset --hard is performed" is a direct observation of
;; whether :reset! was ever invoked, not merely inferred from git state.
(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "master_main_reconcile_lib.bb")))

(def root (first *command-line-args*))
(when-not root
  (binding [*out* *err*] (println "usage: bl1198RematchPushFirstCli.bb <repo-root>"))
  (System/exit 2))

(defn sh [& args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str root) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

;; The production caller (post_hotfix_merge_origin_lib.bb's run-post-hotfix-
;; merge!) always fetches before deciding to reset, so `origin/main`'s
;; remote-tracking ref is current when :reset! reads it. Mirrored here -
;; without it, :reset! would land on a stale cached tip rather than origin's
;; real, current one.
(sh "git" "fetch" "origin" "main")

(def push-attempted? (atom false))
(def reset-attempted? (atom false))

(def reset-adapters
  (master-main-reconcile-lib/real-git-reset-adapters
   {:sh! sh :reset-attempted? reset-attempted?}))

(def result
  (master-main-reconcile-lib/rematch-with-push-first!
   {:push! (fn []
             (reset! push-attempted? true)
             (let [r (sh "git" "push" "origin" "main")]
               {:success (zero? (:exit r)) :error (:err r)}))
    :reset! (fn []
              (master-main-reconcile-lib/refuse-reset-if-local-ahead! reset-adapters))}))

(println (json/generate-string {:pushed (= :pushed (:outcome result))
                                 :pushAttempted @push-attempted?
                                 :resetAttempted @reset-attempted?
                                 :outcome (some-> (:outcome result) name)
                                 :error (:error result)}))
(System/exit 0)
