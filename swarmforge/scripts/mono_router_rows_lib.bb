#!/usr/bin/env bb
;; mono_router_rows_lib.bb — Hotfix 2026-09-14 (human directive): a
;; non-home resident whose mailbox just emptied and that has NO parcel to
;; follow (it consumed a note, or its last forward is already taken) must
;; rotate to the router's own next target, not hop home and wait for the
;; chase sweep to bring it there one respawn later.
;;
;; This is the dispatcher-side copy of handoffd.bb's role-mail-row /
;; preferred-mono-rotate-role (the SOURCE OF TRUTH - keep them in step).
;; The dispatchers (ready_for_next_task.bb / ready_for_next_batch.bb) run
;; inside a role pane and must NOT spawn handoffd.bb for its one-shot
;; --print-preferred-rotate-target mode: that path runs
;; self-heal-stale-stubs! and the ordering-warning pass first and writes
;; into the daemon's own log. Drift guard: test_handoffd_priority_rotate_wiring.sh
;; asserts mono_router_rows_cli.bb answers exactly what the daemon's print
;; mode answers on every one of its fixtures.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "mono_router_rows_lib.bb")))

(ns mono-router-rows-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "chase_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "mono_router_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

(defn- conf-text
  "The effective pack conf (whatever swarm-identity recorded at launch),
   resolved exactly as handoffd.bb's note-actionable-after-ms does."
  [root]
  (try (slurp (str (backlog-depth-lib/conf-file-path root)))
       (catch Exception _ nil)))

(defn- header-field [path field]
  (try (handoff-lib/header-field path field) (catch Exception _ nil)))

(defn- envelope [path]
  (try (handoff-lib/parse-envelope (slurp path))
       (catch Exception _ {:headers {} :body ""})))

(defn role-mail-row
  "Score one role's mailbox for rotate preference - the same set and the
   same fields as handoffd.bb's role-mail-row: held in_process work plus
   ambulance-filtered new git_handoff / rule_proposal / aged-note parcels;
   :best-priority, :newest-created-at, :oldest-actionable-waited-ms and
   :actionable? computed over exactly that set."
  [role-info {:keys [now-ms threshold-ms ambulance]}]
  (let [new-dir (str (handoff-lib/mailbox-dir role-info :new))
        ip-dir (str (handoff-lib/mailbox-dir role-info :in_process))
        held (chase-sweep-lib/scan-in-process ip-dir)
        news (remove #(ambulance-lib/parcel-held? ambulance (envelope (:filePath %)))
                     (chase-sweep-lib/scan-inbox-new new-dir))
        git-hfs (filterv #(= "git_handoff" (header-field (:filePath %) "type")) news)
        rule-props (filterv #(= "rule_proposal" (header-field (:filePath %) "type")) news)
        note-fs (filterv #(= "note" (header-field (:filePath %) "type")) news)
        aged-notes (filterv #(mono-router-lib/note-aged?
                              {:enqueued-at (header-field (:filePath %) "enqueued_at")
                               :created-at (header-field (:filePath %) "created_at")
                               :now-ms now-ms
                               :threshold-ms threshold-ms})
                            note-fs)
        actionable-parcels (concat held git-hfs rule-props aged-notes)
        newest (or (->> actionable-parcels
                        (keep #(header-field (:filePath %) "created_at"))
                        sort
                        last)
                   "")
        best-priority (mono-router-lib/best-priority-rank
                       (map #(header-field (:filePath %) "priority") actionable-parcels))
        oldest-waited-ms (mono-router-lib/oldest-actionable-waited-ms
                          (map #(hash-map :enqueued-at (header-field (:filePath %) "enqueued_at")
                                          :created-at (header-field (:filePath %) "created_at"))
                               actionable-parcels)
                          now-ms)]
    {:role (:role role-info)
     :newest-created-at newest
     :best-priority best-priority
     :oldest-actionable-waited-ms oldest-waited-ms
     :actionable? (mono-router-lib/actionable-mail?
                   {:in-process-count (count held)
                    :git-handoff-count (count git-hfs)
                    :rule-proposal-count (count rule-props)
                    :aged-note-count (count aged-notes)})}))

(defn mailbox-rows
  "One row per roles.tsv role, in roles.tsv order, read fresh."
  [root]
  (let [conf (conf-text root)
        ctx {:now-ms (System/currentTimeMillis)
             :threshold-ms (mono-router-lib/parse-note-actionable-after-ms conf)
             :ambulance (ambulance-lib/read-ambulance-state (str root))}]
    (mapv #(role-mail-row % ctx) (handoff-lib/load-all-roles root))))

(defn preferred-rotate-role
  "The role the daemon's chase sweep would rotate the resident to right now
   (mono-router-lib/preferred-rotate-target over every role's row, with the
   pack's rotation_starve_after_ms), or nil when nothing is actionable."
  [root]
  (mono-router-lib/preferred-rotate-target
   (mailbox-rows root)
   (mono-router-lib/parse-rotation-starve-after-ms (conf-text root))))
