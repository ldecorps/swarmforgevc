#!/usr/bin/env bb
;; BL-464: the one shell-callable entry point for pipeline_stage_lib.bb's
;; reconcile-stage-map/filter-active - the coordinator's own authoritative
;; ticket->stage source for the Telegram pipeline board (BL-452/455/462),
;; replacing the board's prior in_process/task-header scrape
;; (extension/src/swarm/swarmState.ts's readInProcessTicketIds), which was
;; blind to a note-only kickoff and could show one ticket on two rows during
;; a stage transition (BL-464's own root cause).
;;
;; swarmforge/roles/coordinator.prompt instructs the coordinator to run
;; `sync` immediately after every promotion/routing/bookkeeping/queue-sweep
;; action - the coordinator IS the production writer this store needs (the
;; engineering article's "a consumer that reads a store needs a real
;; production writer of that exact store" rule); the concierge tick
;; (extension/src/swarm/swarmState.ts's readTicketStageMap) is the reader.
;;
;; Usage:
;;   pipeline_stage_cli.bb <project-root> report
;;     Computes and prints the current {ticket-id: role} map as JSON,
;;     without writing anything - a read-only preview.
;;   pipeline_stage_cli.bb <project-root> sync
;;     Computes the SAME map and atomically writes it to
;;     .swarmforge/board/ticket-stage-map.json, then prints it. Idempotent -
;;     safe to run as often as the coordinator's own tracking changes.
;; Exit 0 always - an unresolvable role/ticket just reads as absent from the
;; map (never fabricate a location for a ticket this CLI cannot actually see).

(ns pipeline-stage-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "pipeline_stage_lib.bb")))
(load-file (str (fs/path script-dir "handoff_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: pipeline_stage_cli.bb <project-root> report|sync"))
  (System/exit 1))

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

;; Mirrors ticket_status_lib.bb's own current-status glob exactly -
;; backlog/active/ is flat, so "**.yaml" (rather than one level deep) is a
;; harmless superset here, kept identical to that file's own pattern for
;; the day backlog/active/ ever nests the way backlog/done/ already does.
;;
;; BL-489: upper-cased to match extract-ticket-id's own str/upper-case
;; canonicalization on the stage-map key side - filter-active's
;; case-sensitive membership test only ever agrees when both sides share
;; the same case, so a mis-cased yaml `id:` (ids are conventionally
;; upper-case today, but this is a real when-not-if surface) would
;; otherwise silently drop a genuinely-held ticket from the board.
(defn- active-ticket-ids [project-root]
  (let [dir (fs/path project-root "backlog" "active")]
    (if (fs/exists? dir)
      (set (keep #(some-> (read-yaml-field (slurp (str %)) "id") str/upper-case) (fs/glob dir "**.yaml")))
      #{})))

;; Duplicated from chase_sweep_lib.bb's own (private) list-handoff-files/
;; list-batch-dirs/list-handoff-files-with-batches/read-header-field rather
;; than cross-namespace-coupled to them - the same small-duplication
;; rationale pipeline_stage_lib.bb's own extract-ticket-id comment already
;; gives for this file.
(defn- list-handoff-files [dir]
  (if-not (fs/exists? dir)
    []
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")))
         (map str))))

(defn- list-batch-dirs [dir]
  (if-not (fs/exists? dir)
    []
    (->> (fs/list-dir dir)
         (filter #(and (fs/directory? %) (str/starts-with? (fs/file-name %) "batch_")))
         (map str))))

(defn- list-handoff-files-with-batches [dir]
  (concat (list-handoff-files dir) (mapcat list-handoff-files (list-batch-dirs dir))))

(defn- read-header-field [file-path field]
  (let [header (first (str/split (slurp file-path) #"\n\n" 2))
        prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (subs line (count prefix))))
          (str/split-lines header))))

(defn- role-ticket-pairs-for [role-info]
  (let [dir (str (handoff-lib/mailbox-dir role-info :in_process))]
    (->> (list-handoff-files-with-batches dir)
         (map (fn [f] {:task (read-header-field f "task") :message (read-header-field f "message")}))
         (keep pipeline-stage-lib/ticket-id-from-headers)
         (map (fn [ticket-id] {:role (:role role-info) :ticket-id ticket-id})))))

(defn compute-stage-map [project-root]
  (let [roles (handoff-lib/load-all-roles project-root)
        role-order (mapv :role roles)
        pairs (mapcat role-ticket-pairs-for roles)]
    (pipeline-stage-lib/filter-active
     (pipeline-stage-lib/reconcile-stage-map pairs role-order)
     (active-ticket-ids project-root))))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn stage-map-file [project-root]
  (fs/path project-root ".swarmforge" "board" "ticket-stage-map.json"))

(defn -main [& args]
  (when (not= 2 (count args))
    (usage))
  (let [[project-root subcommand] args
        stage-map (compute-stage-map project-root)]
    (case subcommand
      "report" (println (json/generate-string stage-map))
      "sync" (do (atomic-spit! (stage-map-file project-root) (json/generate-string stage-map))
                 (println (json/generate-string stage-map)))
      (usage))))

(apply -main *command-line-args*)
