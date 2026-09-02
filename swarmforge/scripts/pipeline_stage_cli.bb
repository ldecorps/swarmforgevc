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

;; BL-670: how many times this ticket has been sent back, from the ticket's
;; own `bounce_history:` - BL-635's recorder writes it and it is populated in
;; production today, so the health dot needs no new store.
;;
;; The LIST is counted rather than the `bounce_count:` scalar beside it: the
;; list is the evidence and the scalar is a summary of it, and when a summary
;; and its evidence disagree the evidence is the one to believe. A ticket with
;; no bounces has neither field, which counts as zero without a special case.
(defn- bounce-count-in [yaml-text]
  (->> (str/split-lines yaml-text)
       (drop-while #(not (str/starts-with? % "bounce_history:")))
       rest
       (take-while #(re-matches #"^\s+-\s.*" %))
       count))

(defn- ticket-health-dots [project-root]
  (let [dir (fs/path project-root "backlog" "active")]
    (if-not (fs/exists? dir)
      {}
      (into {}
            (keep (fn [f]
                    (let [text (slurp (str f))]
                      (when-let [id (some-> (read-yaml-field text "id") str/upper-case)]
                        [id (pipeline-stage-lib/health-dot-for-bounces (bounce-count-in text))])))
                  (fs/glob dir "**.yaml"))))))

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

;; BL-1048: the DELIVERED state (:new) is scanned alongside the OPENED one
;; (:in_process). A parcel that has been routed, delivered and woken - but
;; whose recipient has not yet run ready_for_next.sh - names its ticket only
;; in inbox/new/, which this scan never opened; the ticket therefore reached
;; no {ticket -> role} pair, filter-active dropped it, and the board's
;; BL-473 not-started sentinel rendered it NS. That made a SUCCESSFUL
;; handoff read as a regression: the moment a parcel left the coder's
;; in_process for the cleaner's new/, the ticket fell off the stage map and
;; moved backwards to not-started.
;;
;; The not-started column means no role has the parcel - not that no role
;; has OPENED it - and inbox/new/ is exactly the state Article 2.4 puts the
;; ten-minute chase clock on, i.e. the one state the board most needs to
;; show. Both states go through the SAME mailbox-dir resolver (BL-128) and
;; the SAME batch_* enumeration, so a master-resident role's per-role
;; subdirectory and a batch role's delivered batch_* dir are covered by
;; construction rather than by a second re-derived path.
;;
;; This is a SOURCE widening only: ticket-id-from-headers, reconcile-stage-map
;; and filter-active are untouched. Reconciliation already collapses one
;; ticket observed at two roles to a single most-downstream role, which is
;; the transition window this makes more common - not a new case - so
;; BL-464's double row cannot return through it.
;; BL-670: the DURABLE trail (:sent) joins the two live states. A ticket
;; nothing currently holds - every in_process and new/ box empty, which is
;; ordinary between a forward and the next role waking - had no observation
;; at all and fell out of the map entirely, so the board went blind on it.
;; The sent/ trail is where it last was, it is already written for every
;; pipeline role, and handoff_lib's mailbox-dir already resolves :sent, so
;; this reads a store with a live writer rather than depending on new work.
(def ^:private scanned-mailbox-states [:new :in_process :sent])

;; What each mailbox state means ABOUT the ticket, which is the whole of
;; BL-670's semantics half:
;;   in_process - a role has opened it. It is being worked.
;;   new        - it has been delivered to a role that has not opened it yet.
;;   sent       - nobody holds it here; this is only where it went last.
(def ^:private state->status
  {:in_process pipeline-stage-lib/claimed-status
   :new pipeline-stage-lib/in-transit-status
   :sent pipeline-stage-lib/last-known-status})

;; WHOSE stage a parcel in this state names. A parcel in a role's own inbox
;; names that role; a parcel in its SENT box names the role it was sent TO -
;; the trail records where the ticket went, not where it came from, and
;; reading the mailbox owner there would park every finished ticket back on
;; whoever last touched it.
;; BL-1040: every branch here folds a seat id (`coder@sonnet2`, BL-982's
;; seat syntax) onto its STAGE. BL-983 declared that seat identity never
;; escapes the mailbox layer and enforced it only where a seat FORWARDS;
;; this is the OBSERVATION path, and it leaked. A stage map recording
;; `coder@sonnet2` matches no bare stage name at the renderer, so the ticket
;; painted as not-started while the seat was actively working it. The `:sent`
;; branch folds too - a parcel may be addressed to a seat, not just held by
;; one. handoff-lib/seat-stage is the existing chokepoint rather than a
;; fourth hand-rolled indexOf('@').
(defn- role-for-observation [role-info state file]
  (handoff-lib/seat-stage
   (if (= state :sent)
     (some-> (read-header-field file "to") (str/split #",") first str/trim not-empty)
     (:role role-info))))

;; As-of: the parcel's own recorded time, falling back to the file's mtime.
;; A header is preferred because it is the moment the parcel was created,
;; which is what "as of" means to a reader; mtime is the honest fallback for
;; an older parcel written before the header existed.
(defn- as-of-for [file]
  (or (read-header-field file "enqueued_at")
      (read-header-field file "created_at")
      (str (java.time.Instant/ofEpochMilli (fs/file-time->millis (fs/last-modified-time file))))))

(defn- observations-for-state [role-info state]
  (->> (list-handoff-files-with-batches (str (handoff-lib/mailbox-dir role-info state)))
       (keep (fn [f]
               (when-let [ticket-id (pipeline-stage-lib/ticket-id-from-headers
                                     {:task (read-header-field f "task")
                                      :message (read-header-field f "message")})]
                 (when-let [role (role-for-observation role-info state f)]
                   {:role role
                    :ticket-id ticket-id
                    :status (get state->status state)
                    :as-of (as-of-for f)}))))))

(defn- role-ticket-pairs-for [role-info]
  (mapcat (fn [state] (observations-for-state role-info state)) scanned-mailbox-states))

(defn compute-stage-map [project-root]
  (let [roles (handoff-lib/load-all-roles project-root)
        ;; Distinct STAGES in roles.tsv order - a multi-seat stage occupies
        ;; exactly one position in the precedence order reconcile-stage-entries
        ;; uses for "most downstream wins", and one board column. N seats
        ;; never widen either.
        role-order (vec (distinct (map #(handoff-lib/seat-stage (:role %)) roles)))
        pairs (mapcat role-ticket-pairs-for roles)
        dots (ticket-health-dots project-root)]
    (->> (pipeline-stage-lib/filter-active
          (pipeline-stage-lib/reconcile-stage-entries pairs role-order)
          (active-ticket-ids project-root))
         ;; The dot travels WITH the stage, in the one map both consumers
         ;; read, so the board and BL-659's completion ring cannot end up
         ;; painting a ticket's health from two different counts.
         (reduce-kv (fn [acc ticket-id entry]
                      (assoc acc ticket-id
                             (assoc entry :healthDot (get dots ticket-id
                                                          pipeline-stage-lib/health-dot-green))))
                    {}))))

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
