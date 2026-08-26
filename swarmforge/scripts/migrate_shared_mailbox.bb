#!/usr/bin/env bb

;; BL-128: one-time migration for mail already queued in the shared master
;; inbox at upgrade time, into each master-resident role's new physical
;; mailbox (mailbox-isolation-05). Never deletes: every .handoff/.error file
;; is MOVED (collision-safe) out of the old shared tree into the correct
;; role's own mailbox; the old (now-empty) directories are left in place.
;;
;; Usage: migrate_shared_mailbox.bb <project-root> [--dry-run]
;;
;; Routing:
;;   inbox/{new,in_process,completed,abandoned} are RECIPIENT-owned (stamped
;;   by handoffd.bb's add-delivery-headers at delivery time) - routed by each
;;   file's own `recipient:` header (falling back to `to:` for a hand-placed
;;   file that predates delivery). A file whose header is absent, blank, or
;;   names a role that isn't master-resident goes to the specifier's mailbox
;;   with a logged warning, per this ticket's own explicit fallback.
;;
;;   outbox/sent/failed are SENDER-owned (a queued-but-undelivered, or
;;   already-delivered-and-archived, item never carries a `recipient:`
;;   header at all) - routed by each file's own `from:` header instead, same
;;   untagged fallback to specifier.
;;
;;   sequence/sequence.lock: the old shared counter is COPIED (not moved) as
;;   the seed for every master-resident role that doesn't already have its
;;   own sequence file - each role's counter is then independent going
;;   forward, which is safe because sequence numbers are only ever compared
;;   within one sender's own filenames, never across senders.
;;
;; Rehearse against a scratch fixture before running on a live swarm's repo
;; (this ticket's own "clean daemon/queue-drain moment" warning) - see
;; test/test_migrate_shared_mailbox.sh.

(ns migrate-shared-mailbox
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: migrate_shared_mailbox.bb <project-root> [--dry-run]"))
  (System/exit 1))

(def project-root
  (or (first *command-line-args*) (usage)))

(def dry-run? (some #{"--dry-run"} *command-line-args*))

(defn header-field [file field]
  (let [prefix (str field ": ")]
    (some (fn [line]
            (when (str/starts-with? line prefix)
              (subs line (count prefix))))
          (take-while (complement str/blank?)
                      (str/split-lines (slurp (str file)))))))

(defn handoff-like-files [dir]
  (when (fs/exists? dir)
    (filter #(and (fs/regular-file? %)
                  (or (str/ends-with? (fs/file-name %) ".handoff")
                      (str/ends-with? (fs/file-name %) ".handoff.error")))
            (fs/list-dir dir))))

(defn move-with-collision!
  "Moves source into target-dir, disambiguating on a name collision instead
   of clobbering (same convention as handoffd.bb's own move-with-collision).
   A dry run must not touch the filesystem at all, not even to create the
   destination directory - so the create-dirs call itself is gated too."
  [source target-dir]
  (when-not dry-run? (fs/create-dirs target-dir))
  (let [filename (fs/file-name source)
        base (fs/path target-dir filename)]
    (if (fs/exists? base)
      (loop [n 1]
        (let [candidate (fs/path target-dir (str n "_" filename))]
          (if (fs/exists? candidate)
            (recur (inc n))
            (do (when-not dry-run? (fs/move source candidate)) candidate))))
      (do (when-not dry-run? (fs/move source base)) base))))

;; ── inbox states: recipient-owned ────────────────────────────────────────

(def recipient-states [:new :in_process :completed :abandoned])

(defn migrate-recipient-state! [old-base state master-roles fallback-role stats]
  (let [dir (apply fs/path old-base (case state
                                       :new ["inbox" "new"]
                                       :in_process ["inbox" "in_process"]
                                       :completed ["inbox" "completed"]
                                       :abandoned ["inbox" "abandoned"]))]
    (doseq [file (handoff-like-files dir)]
      (let [recipient (or (header-field file "recipient") (header-field file "to"))
            role-info (get master-roles recipient)
            target-role (or role-info fallback-role)
            untagged? (nil? role-info)]
        (when untagged?
          (println (str "WARNING: " (fs/file-name file) " has no recognized recipient"
                         (when recipient (str " (recipient=" recipient ")"))
                         " - routing to specifier")))
        (let [moved (move-with-collision! file (handoff-lib/mailbox-dir target-role state))]
          (swap! stats update state (fnil inc 0))
          (println (str (if dry-run? "WOULD-MOVE " "MOVED ") (fs/file-name file)
                         " -> " (str moved))))))))

;; ── outbox/sent/failed: sender-owned ─────────────────────────────────────

(def sender-states [:outbox :sent :failed])

(defn migrate-sender-state! [old-base state master-roles fallback-role stats]
  (let [dir (fs/path old-base (name state))]
    (doseq [file (handoff-like-files dir)]
      (let [sender (header-field file "from")
            role-info (get master-roles sender)
            target-role (or role-info fallback-role)
            untagged? (nil? role-info)]
        (when untagged?
          (println (str "WARNING: " (fs/file-name file) " has no recognized sender"
                         (when sender (str " (from=" sender ")"))
                         " - routing to specifier")))
        (let [moved (move-with-collision! file (handoff-lib/mailbox-dir target-role state))]
          (swap! stats update state (fnil inc 0))
          (println (str (if dry-run? "WOULD-MOVE " "MOVED ") (fs/file-name file)
                         " -> " (str moved))))))))

;; ── sequence counter: copied (not moved), only where the role has none yet ──

(defn migrate-sequence! [old-base master-roles]
  (let [old-seq (fs/path old-base "sequence")]
    (when (fs/exists? old-seq)
      (doseq [role-info (vals master-roles)]
        (let [new-seq (fs/path (handoff-lib/mailbox-base-dir role-info) "sequence")]
          (when-not (fs/exists? new-seq)
            (println (str (if dry-run? "WOULD-SEED " "SEEDED ") (str new-seq)
                           " from " (str old-seq)))
            (when-not dry-run?
              (fs/create-dirs (fs/parent new-seq))
              (fs/copy old-seq new-seq))))))))

(defn -main []
  (let [all-roles (handoff-lib/load-all-roles project-root)
        master-role-infos (filter #(= (:worktree-name %) "master") all-roles)
        master-roles (into {} (map (juxt :role identity) master-role-infos))
        specifier (or (get master-roles "specifier") (first master-role-infos))]
    (when (empty? master-role-infos)
      (println "No master-resident roles found in roles.tsv - nothing to migrate.")
      (System/exit 0))
    (when-not specifier
      (binding [*out* *err*]
        (println "No specifier (or any master-resident role) found to use as the untagged-file fallback."))
      (System/exit 1))
    ;; Every master-resident role shares one physical worktree-path by
    ;; definition (that's what made them share an inbox); the pre-BL-128
    ;; shared tree lives at that one worktree-path's flat .swarmforge/handoffs.
    (let [old-base (fs/path (:worktree-path specifier) ".swarmforge" "handoffs")
          stats (atom {})]
      (println (str (if dry-run? "[DRY RUN] " "") "Migrating shared mailbox at " (str old-base)
                     " for roles: " (str/join ", " (keys master-roles))))
      (doseq [state recipient-states]
        (migrate-recipient-state! old-base state master-roles specifier stats))
      (doseq [state sender-states]
        (migrate-sender-state! old-base state master-roles specifier stats))
      (migrate-sequence! old-base master-roles)
      (println (str "Done. Migrated: " (pr-str @stats))))))

(-main)
