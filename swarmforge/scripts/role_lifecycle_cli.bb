#!/usr/bin/env bb

;; BL-324: the one shell-callable entry point for role_lifecycle_lib.bb's
;; evaluate-role-lifecycle! - the coordinator calls this ON PROMOTE (mirrors
;; quiet_period_gate_cli.bb's own CLI-wrapper shape for BL-318's gate: a
;; ticket YAML PATH in, never a hand-assembled role list, so this is never
;; a second place a role list can be typo'd). Never reimplements decision
;; logic itself - role_lifecycle_lib.bb stays the single source of truth;
;; this file only gathers real state (the promoted ticket's manifest, the
;; next queued candidate's manifest, the live roster + idle state), calls
;; it, and enacts the result via real fs/tmux adapters (role_lifecycle.sh).
;;
;; Usage:
;;   role_lifecycle_cli.bb <project-root> shape <promoted-ticket-yaml-path>
;;     Brings the roster to the promoted ticket's shape - parks every
;;     parkable role, unparks every needed-but-absent role, exempting
;;     warm-core roles and any role the NEXT queued paused candidate
;;     (backlog/paused/, priority order, pull-eligible) still needs.
;;     Prints a JSON {:parked [...] :unparked [...]} report and exits 0.

(ns role-lifecycle-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)))))

(load-file (str (fs/path script-dir "role_lifecycle_lib.bb")))
(load-file (str (fs/path script-dir "operator_lib.bb")))
(load-file (str (fs/path script-dir "routing_manifest_lib.bb")))
(load-file (str (fs/path script-dir "handoff_lib.bb")))

(def role-lifecycle-sh (fs/path script-dir "role_lifecycle.sh"))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: role_lifecycle_cli.bb <project-root> shape <promoted-ticket-yaml-path>"))
  (System/exit 2))

;; ── real fs adapters: roles.tsv row surgery ────────────────────────────────

(defn- roles-file [project-root] (fs/path project-root ".swarmforge" "roles.tsv"))

(defn- read-roster-rows [project-root]
  (let [f (roles-file project-root)]
    (if (fs/exists? f)
      (vec (remove str/blank? (str/split-lines (slurp (str f)))))
      [])))

(defn- role-of-row [row] (first (str/split row #"\t")))

;; Returns the removed row's own raw text (opaque to role_lifecycle_lib.bb,
;; handed back verbatim to restore-role-row! below) - the per-kill re-check
;; (scope 4b / per-role-lifecycle-07/08) needs a real row to restore if the
;; role turns out to no longer be idle, and re-deriving one via row-for
;; would re-run swarmforge.conf parsing for no reason when the exact row
;; is already sitting right here.
(defn- remove-role-row! [project-root role]
  (let [f (roles-file project-root)
        rows (read-roster-rows project-root)
        removed (first (filter #(= role (role-of-row %)) rows))
        remaining (remove #(= role (role-of-row %)) rows)]
    (fs/create-dirs (fs/parent f))
    (spit (str f) (if (seq remaining) (str (str/join "\n" remaining) "\n") ""))
    removed))

(defn- restore-role-row! [project-root role removed-row]
  (when removed-row
    (let [f (roles-file project-root)]
      (fs/create-dirs (fs/parent f))
      (spit (str f) (str removed-row "\n") :append true))))

(defn- run-role-lifecycle-sh! [project-root subcommand role]
  (process/sh {:continue true} "bash" (str role-lifecycle-sh) project-root subcommand role))

;; FAIL LOUD (this codebase's own established convention - BL-317/BL-327):
;; a role a ticket's manifest names but that isn't actually a role
;; swarmforge.conf configures for this pack (a lean-drain pack missing a
;; chain member, or a typo) must never be silently swallowed into a report
;; that claims success while nothing happened - it throws, aborting the
;; whole shape pass loudly rather than reporting a phantom unpark.
(defn- add-role-row! [project-root role]
  (let [{:keys [out exit err]} (run-role-lifecycle-sh! project-root "row-for" role)
        row (str/trim (or out ""))]
    (when (or (not (zero? exit)) (str/blank? row))
      (throw (ex-info (str "could not resolve roles.tsv row for " role " (not configured for this pack?): " err)
                       {:role role :exit exit :err err})))
    (let [f (roles-file project-root)]
      (fs/create-dirs (fs/parent f))
      (spit (str f) (str row "\n") :append true))))

;; ── real tmux adapters (shelled through role_lifecycle.sh - see its own
;;    header for why the bash half exists: reusing swarmforge.sh's config
;;    parsing + session/launch-script machinery, never a second one) ──────

(defn- kill-role-session! [project-root role]
  ;; A no-op ("no session found") is benign here - the role's pane may
  ;; already be dead on its own before park ran - never an error. Only
  ;; row-for/unpark (role not found in config AT ALL) fail loud above/below.
  (run-role-lifecycle-sh! project-root "kill-session" role))

(defn- respawn-role! [project-root role]
  (let [{:keys [exit err]} (run-role-lifecycle-sh! project-root "unpark" role)]
    (when-not (zero? exit)
      (throw (ex-info (str "could not respawn " role " (not configured for this pack?): " err)
                       {:role role :exit exit :err err})))))

;; ── real state gathering ────────────────────────────────────────────────

(defn- count-handoff-files [dir]
  (if (fs/exists? dir)
    (count (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")) (fs/list-dir dir)))
    0))

(defn- role-idle-now? [role-info]
  (operator-lib/role-idle?
   {:inbox-new-count (count-handoff-files (handoff-lib/mailbox-dir role-info :new))
    :in-process-count (count-handoff-files (handoff-lib/mailbox-dir role-info :in_process))}))

(defn- current-roster [project-root]
  "Every roles.tsv row paired with its idle state AND its own role-info
   (worktree-path etc, captured NOW while the row still exists) - the
   per-kill re-check below (scope 4b / per-role-lifecycle-07/08) needs
   this to re-read the SAME mailbox directories after remove-role-row!
   has already deleted the row from roles.tsv, when a fresh roles.tsv
   lookup could no longer find it at all."
  (vec (for [role-info (handoff-lib/load-all-roles project-root)
             :when (:worktree-path role-info)]
         {:role (:role role-info)
          :idle? (role-idle-now? role-info)
          :role-info role-info})))

;; FAIL LOUD before the shape pass even starts: if a role's own mailbox
;; can no longer be re-derived (should never happen - role-info is
;; captured from the SAME live roles.tsv read this whole pass already
;; used), still-idle? must never silently answer "yes" and let a park
;; proceed on a check it could not actually perform.
(defn- real-adapters [project-root roster]
  (let [role-info-by-name (into {} (map (juxt :role :role-info) roster))]
    {:remove-role-row! (fn [role] (remove-role-row! project-root role))
     :still-idle? (fn [role]
                    (if-let [role-info (get role-info-by-name role)]
                      (role-idle-now? role-info)
                      (throw (ex-info (str "cannot re-check idleness for " role " - no captured role-info")
                                       {:role role}))))
     :restore-role-row! (fn [role removed-row] (restore-role-row! project-root role removed-row))
     :kill-role-session! (fn [role] (kill-role-session! project-root role))
     :add-role-row! (fn [role] (add-role-row! project-root role))
     :respawn-role! (fn [role] (respawn-role! project-root role))}))

;; Duplicated from operator_runtime.bb's own private read-yaml-field - the
;; same small live-glue duplication already established across this
;; codebase's independent pure libs/CLIs.
(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn- yaml-files [dir]
  (if (fs/exists? dir)
    (filter #(str/ends-with? (fs/file-name %) ".yaml") (fs/list-dir dir))
    []))

(defn- paused-items-excluding [project-root exclude-path]
  "Every OTHER paused ticket's {:status :priority :roles} - the promoted
   ticket itself is excluded (it is the CURRENT shape, never its own
   lookahead candidate)."
  (let [exclude (fs/canonicalize exclude-path)]
    (vec (for [f (yaml-files (fs/path project-root "backlog" "paused"))
               :when (not= (fs/canonicalize f) exclude)
               :let [content (slurp (str f))]]
           {:status (read-yaml-field content "status")
            :priority (some-> (read-yaml-field content "priority") parse-long)
            :roles (routing-manifest-lib/read-roles content)}))))

;; ── BL-343: real park/unpark event log ──────────────────────────────────
;; The break-even measurement this ticket asks for needs REAL
;; (parkedAtMs, unparkedAtMs) pairs, never an estimate - this is the ONLY
;; place a real park/unpark decision is enacted (SINGLE OWNER, same
;; posture as build_freshness_cli.bb's own header comment), so it is the
;; one correct place to record the fact that one happened. Recording is
;; best-effort and never blocks/aborts a shape pass - a logging failure
;; must never be why a role fails to park or unpark.

(defn- park-cycle-log-file [project-root]
  (fs/path project-root ".swarmforge" "role-lifecycle" "park-cycle-log.jsonl"))

(defn- log-park-cycle-event! [project-root event role]
  (try
    (let [f (park-cycle-log-file project-root)]
      (fs/create-dirs (fs/parent f))
      (spit (str f)
            (str (json/generate-string {:event event :role role :atMs (System/currentTimeMillis)}) "\n")
            :append true))
    (catch Exception _ nil)))

;; Only a GENUINE park (evaluate-role-lifecycle!'s own {:parked role}
;; without :aborted? true - see role_lifecycle_lib.bb's park-role!
;; docstring for the per-kill re-check that can abort one) is logged as a
;; park event; an aborted attempt never removed the role from service, so
;; recording it would fabricate an idle window that never happened.
(defn- log-shape-result! [project-root {:keys [parked unparked]}]
  (doseq [park-entry parked :when (and (:parked park-entry) (not (:aborted? park-entry)))]
    (log-park-cycle-event! project-root "park" (:parked park-entry)))
  (doseq [unpark-entry unparked :when (:unparked unpark-entry)]
    (log-park-cycle-event! project-root "unpark" (:unparked unpark-entry))))

(defn- run-shape! [project-root ticket-path]
  (let [content (try (slurp ticket-path) (catch Exception _ nil))]
    (when (nil? content)
      (binding [*out* *err*] (println (str "error: ticket unreadable: " ticket-path)))
      (System/exit 2))
    ;; FAIL LOUD before touching a single role: an invalid manifest (missing
    ;; coder/QA, naming coordinator, or unparseable) must never be acted on
    ;; as-is - shaping the swarm around it could park coder itself. BL-317's
    ;; own validator is the single source of truth for what "valid" means;
    ;; this is never a second implementation of that check.
    (let [validation (routing-manifest-lib/validate-manifest content)]
      (when-not (:valid? validation)
        (binding [*out* *err*] (println (str "error: invalid roles: manifest - " (:reason validation))))
        (System/exit 2)))
    (let [current-needed (routing-manifest-lib/read-roles content)
          next-needed (role-lifecycle-lib/next-queued-roles (paused-items-excluding project-root ticket-path))
          roster (current-roster project-root)]
      (try
        (let [result (role-lifecycle-lib/evaluate-role-lifecycle!
                      roster current-needed next-needed (real-adapters project-root roster))]
          (log-shape-result! project-root result)
          (println (json/generate-string result))
          (System/exit 0))
        (catch Exception e
          (binding [*out* *err*] (println (str "error: " (.getMessage e))))
          (System/exit 2))))))

(defn -main [& args]
  (let [[project-root subcommand ticket-path] args]
    (when (or (str/blank? project-root) (not= subcommand "shape") (str/blank? ticket-path))
      (usage))
    (run-shape! project-root ticket-path)))

(apply -main *command-line-args*)
