#!/usr/bin/env bb
;; ticket_active_on_main_lib.bb — BL-1614: is TICKET-ID active in
;; backlog/active on the freshest of main/origin-main (landed_ticket_lib.bb's
;; BL-992 ref-freshness reader — never a second freshness walk), and is it
;; ALSO present in backlog/active of a given worktree's own working tree
;; right now (a plain filesystem read, no git)?
;;
;; Shared by done_with_current_task.bb's Work-note gate (BL-1422's
;; work-note-completion-decision's new fourth input) and
;; ready_for_next_task.bb's claim-time hint, so both read the exact same
;; main-side fact off the exact same ref, never the worktree, and the
;; worktree-side read stays a single plain glob.
;;
;; Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "ticket_active_on_main_lib.bb")))
;; and referred to as ticket-active-on-main-lib/foo.

(ns ticket-active-on-main-lib
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "landed_ticket_lib.bb")))

(defn- ref-short-sha
  "10-hex commit the ref names, or nil on any git error - never throws."
  [root ref]
  (try
    (let [r (sh/sh "git" "-C" (str root) "rev-parse" "--short=10" ref)]
      (when (zero? (:exit r)) (str/trim (:out r))))
    (catch Exception _ nil)))

(defn active-on-main
  "{:active? true|false|nil :ref <string or nil> :sha <10-hex or nil>},
   answered off the SINGLE freshest of main/origin-main
   (landed-ticket-lib/declaration-refs' own ahead-of-the-two ordering —
   never a second candidate). :active? is nil (unreadable) only when
   NEITHER ref resolves at all; found-in-backlog/active, found-elsewhere,
   and found-nowhere all answer true/false off that one ref."
  [root ticket-id]
  (let [refs (landed-ticket-lib/declaration-refs root)]
    (if (empty? refs)
      {:active? nil :ref nil :sha nil}
      (let [ref (first refs)
            lanes (set (landed-ticket-lib/ticket-lanes-at-ref root ref ticket-id))]
        {:active? (contains? lanes :active)
         :ref ref
         :sha (ref-short-sha root ref)}))))

(defn worktree-active?
  "Is ticket-id's own YAML (matched by its `id:` field, never a filename
   glob) present under root's OWN backlog/active/ right now - a plain
   filesystem read, never git, so it answers for whatever this worktree's
   working tree currently holds regardless of what it has or has not
   merged."
  [root ticket-id]
  (let [dir (fs/path root "backlog" "active")]
    (boolean
     (and (fs/exists? dir)
          (some (fn [f]
                  (= ticket-id (landed-ticket-lib/yaml-id-field
                                (try (slurp (str f)) (catch Exception _ nil)))))
                (fs/glob dir "**.yaml"))))))
