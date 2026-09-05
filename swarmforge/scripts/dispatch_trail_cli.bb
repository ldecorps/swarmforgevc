#!/usr/bin/env bb

;; BL-1097: the one shell-callable entry point for chase_sweep_lib.bb's
;; dispatch-trail predicate - the question "has this ticket ever been
;; dispatched?".
;;
;; It exists because the coordinator's router is bash and the predicate is
;; Babashka, and the answer must be the SAME answer the daemon's BL-222
;; dispatch-gap sweep gets. Re-deriving it in bash (grep the mailboxes for the
;; id) would be a second implementation of a predicate whose whole point is
;; that there is only one - see the ticket's second invariant, and
;; mailbox_dir.bb's own header for the same "no duplicated logic across the
;; bash/babashka boundary" rule.
;;
;; Usage:
;;   dispatch_trail_cli.bb <project-root> dispatched <ticket-id>
;;       Prints DISPATCHED, UNDISPATCHED, or DROPPED <reason> (BL-1415: a
;;       dispatch trail exists, no live mail anywhere, and it went stale past
;;       the stall threshold with no work since - chase_sweep_lib.bb's
;;       ticket-dispatch-verdict-in, the SAME predicate the dropped-parcel
;;       sweep uses). Exit 0 in every case - this is a question, not a gate;
;;       the caller decides what to do with the answer.
;;   dispatch_trail_cli.bb <project-root> undispatched-active
;;       Prints the id of every backlog/active/ item with no dispatch trail,
;;       one per line - the sweep's own answer, exposed so the two can be
;;       compared over a real corpus.
;;
;; Exit 1 with an error on stderr for a usage error or an unreadable role
;; table. A caller that cannot get an answer must NOT silently assume
;; "dispatched": that would strand a real ticket forever, which is a worse
;; failure than the re-route this ticket is about. route_backlog_to_coder.sh
;; deliberately routes (with a warning) when this CLI cannot answer.

(ns dispatch-trail-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "chase_sweep_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: dispatch_trail_cli.bb <project-root> dispatched <ticket-id>")
    (println "       dispatch_trail_cli.bb <project-root> undispatched-active"))
  (System/exit 1))

(defn scan-dirs-for [root]
  (let [roles (handoff-lib/load-all-roles root)]
    (when (empty? roles)
      (binding [*out* *err*]
        (println (str "dispatch_trail_cli: no roles in " root "/.swarmforge/roles.tsv - cannot read a dispatch trail")))
      (System/exit 1))
    (chase-sweep-lib/dispatch-trail-dirs roles)))

;; BL-1415: the same roles.tsv read, narrowed to :new/:in_process - the
;; scope the sweep's own live-mail? question uses. A second load-all-roles
;; call is cheap and keeps scan-dirs-for's own exit-on-empty behavior
;; untouched for its existing caller.
(defn- live-mail-dirs-for [root]
  (chase-sweep-lib/live-mail-trail-dirs (handoff-lib/load-all-roles root)))

(defn- stall-threshold-ms [root]
  (chase-sweep-lib/parse-dropped-parcel-stall-threshold-ms
   (try (slurp (str (fs/path root "swarmforge" "swarmforge.conf"))) (catch Exception _ nil))))

(defn -main [& args]
  (let [[root command ticket-id] args]
    (when (or (nil? root) (nil? command)) (usage))
    (let [root (str (fs/absolutize root))]
      (case command
        "dispatched"
        (do
          (when (nil? ticket-id) (usage))
          (let [{:keys [verdict reason]}
                (chase-sweep-lib/ticket-dispatch-verdict-in
                 ticket-id (scan-dirs-for root) (live-mail-dirs-for root)
                 (System/currentTimeMillis) (stall-threshold-ms root))]
            (println (case verdict
                       :dispatched "DISPATCHED"
                       :undispatched "UNDISPATCHED"
                       :dropped (str "DROPPED " reason)))))

        "undispatched-active"
        (doseq [item (chase-sweep-lib/dispatch-gap-items
                      (str (fs/path root "backlog" "active"))
                      (scan-dirs-for root))]
          (println (:id item)))

        (usage)))))

(apply -main *command-line-args*)
