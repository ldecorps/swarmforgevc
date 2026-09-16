#!/usr/bin/env bb
;; landed_ticket_lib.bb — BL-1276: reading an ACTIVE ticket's own landed
;; declaration, from the freshest ref rather than from the sender's working
;; tree.
;;
;; Extracted verbatim from swarm_handoff.bb, which has read declarations this
;; way since BL-992, because a SECOND caller now needs the identical answer:
;; task_scope_gate_lib.bb must know the path a ticket declares as its
;; acceptance contract, and the send-time gate and the review-time CLI
;; (BL-1257) must never disagree about it. One reader, two callers - never a
;; second copy of the ref-freshness logic, which is the drift trap the
;; engineering rules name.
;;
;; BL-992's reasoning, unchanged and load-bearing: a pipeline role merges main
;; only at handoff boundaries, so between the coordinator promoting a ticket on
;; main and the sender merging, the ticket does not exist in the sender's
;; WORKING TREE at all - measured 2026-08-20, 2 of 7 active tickets were
;; invisible to all six pipeline worktrees. Either of main/origin-main can be
;; the stale one (BL-891), so they are compared, never trusted; a root where
;; neither resolves falls back to the working-tree glob unchanged; and NOTHING
;; here ever throws - every git hiccup degrades to the next candidate.

(ns landed-ticket-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))

(defn- command [dir & args]
  (daemon-cycle-guard-lib/sh! (vec args) {:dir (str dir)}))

(defn yaml-id-field
  "The ticket id a yaml's own `id:` field states, or nil."
  [content]
  (some (fn [line] (when (str/starts-with? line "id: ") (str/trim (subs line 4))))
        (str/split-lines (or content ""))))

(defn ref-resolves? [root ref]
  (try
    (zero? (:exit (command root "git" "rev-parse" "--verify" "--quiet" (str ref "^{commit}"))))
    (catch Exception _ false)))

(defn declaration-refs
  "The refs to read a declaration from, freshest first. When both main and
   origin/main resolve, `git rev-list --left-right --count` decides which
   is ahead; diverged or undecidable keeps local main first (the field
   measurement's fresh side) with the other as second candidate."
  [root]
  (let [m? (ref-resolves? root "main")
        o? (ref-resolves? root "origin/main")]
    (cond
      (and m? o?)
      (let [r (try (command root "git" "rev-list" "--left-right" "--count" "main...origin/main")
                   (catch Exception _ nil))
            [l rgt] (when (and r (zero? (:exit r)))
                      (map parse-long (str/split (str/trim (:out r)) #"\s+")))]
        (if (and l rgt (zero? l) (pos? rgt))
          ["origin/main" "main"]
          ["main" "origin/main"]))
      m? ["main"]
      o? ["origin/main"]
      :else [])))

(defn- ticket-yaml-at-ref-in
  "ticket-yaml-at-ref's own body, generalized to an arbitrary backlog
   subpath - `backlog/done`'s pathspec covers the whole subtree, so a
   ticket nested under a milestone folder (backlog/done/M8/BL-....yaml) is
   found exactly like an unnested one. nil on any git error, a
   non-matching ref, or no candidate - never throws."
  [root ref ticket-id subpath]
  (try
    (let [g (command root "git" "grep" "-l" "-E"
                     (str "^id:[[:space:]]*" ticket-id "[[:space:]]*$")
                     ref "--" subpath)]
      (when (zero? (:exit g))
        (some (fn [line]
                (let [path (second (str/split line #":" 2))
                      s (when path (command root "git" "show" (str ref ":" path)))]
                  (when (and s (zero? (:exit s)))
                    (let [content (:out s)]
                      (when (= ticket-id (yaml-id-field content)) content)))))
              (remove str/blank? (str/split-lines (:out g))))))
    (catch Exception _ nil)))

(defn ticket-yaml-at-ref
  "The ticket's yaml CONTENT at ref, matched by its OWN id: field exactly -
   the anchored git-grep is only a cheap candidate filter; correctness
   comes from re-checking yaml-id-field on the shown content, so a ref
   carrying only BL-9005 can never resolve a BL-900 lookup (BL-992
   invariant 3, same guard as the working-tree path). nil on any git
   error, a non-matching ref, or no candidate - never throws."
  [root ref ticket-id]
  (ticket-yaml-at-ref-in root ref ticket-id "backlog/active"))

;; ── BL-1547: which backlog lane(s) hold a ticket, at a ref ───────────────

(def ^:private backlog-lanes
  [[:active "backlog/active"]
   [:paused "backlog/paused"]
   [:hold "backlog/hold"]
   [:done "backlog/done"]])

(defn ticket-lanes-at-ref
  "Every backlog lane (:active :paused :hold :done) whose tree at ref
   contains ticket-id's own YAML (id: field match, never a filename glob).
   Empty when the ticket is found in no lane at ref - absence and an
   unreadable listing are deliberately not told apart here, since
   ticket-closed? below treats both the same way (fail-closed: no
   exemption). More than one entry means the ticket's YAML is present in
   two lanes at once on the SAME ref - a bookkeeping state the caller must
   never resolve by picking one."
  [root ref ticket-id]
  (vec (keep (fn [[lane subpath]]
               (when (ticket-yaml-at-ref-in root ref ticket-id subpath) lane))
             backlog-lanes)))

(defn ticket-closed?
  "BL-1547: is ticket-id closed - its YAML found under backlog/done, and
   under no other lane - on the freshest of main/origin-main (BL-992's own
   freshest-ref resolution above, never a second ref-freshness walk)?
   Consults declaration-refs in order and answers from the FIRST ref that
   finds the ticket in some lane at all; a ref that finds it in no lane
   falls through to the next ref rather than concluding closed or open
   from silence. No ref ever resolving it - the ticket is absent
   everywhere, or every ref is itself unreadable - answers false: the
   fail-closed default, no exemption, the existing foreign-scope refusal
   stands."
  [root ticket-id]
  (boolean
   (first (keep (fn [ref]
                  (let [lanes (ticket-lanes-at-ref root ref ticket-id)]
                    (when (seq lanes) (= [:done] lanes))))
                (declaration-refs root)))))

(defn active-ticket-yaml-content
  "Reads the active ticket whose OWN `id:` field equals ticket-id exactly -
   never a filename-prefix glob, which would wrongly match e.g. BL-9005's
   file when looking up BL-900 (the same false-collision failure mode
   ticket_status_lib.bb's own contains-ticket? already guards against).
   BL-992: the freshest resolvable ref is consulted FIRST (a declaration
   present on it is never invisible, whatever the sender's working tree
   contains); the working-tree glob remains the fallback for roots with no
   resolvable ref and for tickets not yet committed anywhere."
  [root ticket-id]
  (when ticket-id
    (or (some #(ticket-yaml-at-ref root % ticket-id) (declaration-refs root))
        (let [active-dir (fs/path root "backlog" "active")]
          (when (fs/exists? active-dir)
            (some (fn [f]
                    (let [content (try (slurp (str f)) (catch Exception _ nil))]
                      (when (= ticket-id (yaml-id-field content)) content)))
                  (fs/glob active-dir "**.yaml")))))))
