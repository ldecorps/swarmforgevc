#!/usr/bin/env bb
;; BL-458: pure decision logic for the orphaned acceptance-test-fixture
;; reaper - see fixture_reaper_sweep_lib.bb for the thin wiring slice (real
;; /tmp listing, mtime/process/tmux-socket reads, kill+rm-rf) that calls
;; this. Sibling of BL-413's sandbox_sweep_lib.bb (dir sweep); this ticket
;; is the PROCESS half - it kills orphaned supervisor/bridge/bot/tmux trees
;; a crashed acceptance run left behind, so BL-413's own dir sweep (which
;; deliberately SKIPS any dir with a live process rooted in it) can later
;; remove the emptied root.
;;
;; GUARDRAILS (same posture as BL-413 - a careless reaper can DECAPITATE the
;; running swarm):
;;   - an ALLOWLIST of known test-fixture name prefixes, never a denylist;
;;   - the live swarm's own socket root is excluded EXPLICITLY, checked
;;     FIRST, and wins over every other condition including age.

(ns fixture-reaper-lib
  (:require [clojure.string :as str]))

;; An ALLOWLIST, never a denylist - extend explicitly as new fixture
;; creators are discovered, never widen to a broad glob. Mirrors the
;; prefixes acceptance step files actually mkdtemp under (aps-front-desk-*,
;; aps-*, sfvc-*, bl404-front-desk-*).
(def known-fixture-prefixes ["aps-" "sfvc-" "bl404-front-desk-"])

(defn known-fixture-prefix?
  [name]
  (boolean (some #(str/starts-with? name %) known-fixture-prefixes)))

;; Pure: given one candidate root's decision inputs, return whether the
;; reaper may kill its process tree and remove it. socket-root? is computed
;; by the wiring against the REAL, UID-scoped live socket path - never
;; inferred here from a name pattern - and wins FIRST, ahead of every other
;; condition (proven by an explicit test case where every other signal says
;; "reap").
(defn reapable?
  [{:keys [known-fixture-prefix? stale? socket-root?]}]
  (cond
    socket-root? false
    (not known-fixture-prefix?) false
    (not stale?) false
    :else true))
