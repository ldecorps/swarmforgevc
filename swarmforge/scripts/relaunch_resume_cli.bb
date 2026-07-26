#!/usr/bin/env bb
;; BL-648: relaunch-resume boot-time integration. Two subcommands wire
;; mono_router_lib.bb/resolve-boot-role and orphan_claim_sweep_lib.bb/sweep!
;; (both pure, or pure-adapter, decision logic - see those files) to a real
;; project root, so swarmforge.sh's launch sequence can call this instead of
;; booting the resident at home unconditionally and leaving every other
;; role's in_process claims unverified.
;;
;; Deliberately root-explicit throughout (never relies on handoff_lib.bb's
;; CWD-derived target-root/worktree-root) - the caller (swarmforge.sh) does
;; not `cd` into the target before invoking helper scripts, and this ticket
;; is precisely about cross-worktree launch correctness, so a CWD-dependent
;; read here would be exactly the kind of silent wrong-directory bug BL-648
;; exists to close.
;;
;; Usage:
;;   relaunch_resume_cli.bb resolve-boot-role <project-root>
;;     Prints the role the resident should boot as, on stdout, and ONLY
;;     that - safe to capture via $(...). A fallback (missing/blank/unknown
;;     marker, or a non-router pack) is reported on STDERR, which the
;;     launcher's own log redirection already carries through to the launch
;;     log (BL-648 scenario 03).
;;   relaunch_resume_cli.bb sweep <project-root> [resumed-role]
;;     Runs the orphan-claim sweep for every role in roles.tsv, excluding
;;     resumed-role (pass "" or omit outside `rotation router`) from
;;     reclaim. Loud reclaim lines print to stdout, which the caller lets
;;     flow straight into the launch log (BL-648 scenario 04).
;;
;; Never aborts a real launch: an unreadable/missing marker or an empty
;; roles.tsv degrades to home / an empty sweep rather than throwing.

(ns relaunch-resume-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "handoff_lib.bb")))
(load-file (str (fs/path script-dir "swarm_identity_lib.bb")))
(load-file (str (fs/path script-dir "mono_router_lib.bb")))
(load-file (str (fs/path script-dir "orphan_claim_lib.bb")))
(load-file (str (fs/path script-dir "orphan_claim_sweep_lib.bb")))

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: relaunch_resume_cli.bb resolve-boot-role <project-root>")
    (println "   or: relaunch_resume_cli.bb sweep <project-root> [resumed-role]"))
  (System/exit 2))

(defn home-role-at
  "First non-coordinator role in project-root's roles.tsv - pack-agnostic
   resident/home identity, root-explicit (never CWD-derived)."
  [root]
  (some (fn [role-info] (when (not= "coordinator" (:role role-info)) (:role role-info)))
        (handoff-lib/load-all-roles root)))

(defn rotation-mode-at
  "\"router\", \"sequential\", or nil, read from project-root's own
   .swarmforge/swarm-identity (written fresh by THIS launch's
   write_swarm_identity_file before any role session exists)."
  [root]
  (:rotation (swarm-identity-lib/read-identity (str (fs/path root ".swarmforge" "swarm-identity")))))

(defn raw-active-role-marker-at
  "Raw mono-router-active-role marker content at project-root, or nil when
   missing/blank. Deliberately undefaulted - resolve-boot-role itself must
   see the true absence to tell 'no marker' apart from 'unreadable role
   name', so this must never pre-default to home the way
   handoff-lib/read-mono-router-active-role does for its own (different)
   callers."
  [root]
  (let [p (fs/path root ".swarmforge" "mono-router-active-role")]
    (when (fs/exists? p)
      (let [v (str/trim (slurp (str p)))]
        (when-not (str/blank? v) v)))))

(defn cmd-resolve-boot-role [root]
  (let [home (home-role-at root)
        recorded (raw-active-role-marker-at root)
        known (set (map :role (handoff-lib/load-all-roles root)))
        rotation (rotation-mode-at root)
        {:keys [role fallback? reason recorded]}
        (mono-router-lib/resolve-boot-role
         {:home-role home :recorded-role recorded
          :known-roles known :rotation-mode rotation})]
    (when fallback?
      (binding [*out* *err*]
        (println (str "BL-648 LOUD: mono-router-active-role names an unreadable/unknown role '"
                      recorded "' (reason " (name reason) ") - falling back to home role '" role "'."))))
    (println role)))

(defn cmd-sweep [root resumed-role]
  (let [adapters (orphan-claim-sweep-lib/default-adapters root)
        results (orphan-claim-sweep-lib/sweep! (assoc adapters :resumed-role resumed-role))
        reclaimed-count (reduce + (map (comp count :reclaimed) results))]
    (if (pos? reclaimed-count)
      (println (str "BL-648: orphan-claim sweep reclaimed " reclaimed-count " parcel(s)."))
      (println "BL-648: orphan-claim sweep found nothing to reclaim."))))

(let [[cmd & args] *command-line-args*]
  (case cmd
    "resolve-boot-role"
    (if-let [root (first args)]
      (cmd-resolve-boot-role root)
      (usage!))

    "sweep"
    (if-let [root (first args)]
      (cmd-sweep root (second args))
      (usage!))

    (usage!)))
