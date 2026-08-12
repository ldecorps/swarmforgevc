#!/usr/bin/env bb
;; BL-883: prints the composed stable-prefix length for an ARBITRARY
;; materialized repo root, through the real composer
;; (prompt-engine-lib/stable-prefix-text's own root seam, added for BL-859's
;; budget gate) - never a re-derived second implementation that could drift
;; from what boot actually pays. Used to commit-pin an acceptance scenario
;; against a specific historical commit's tree (materialized via
;; `git worktree add`), while always loading THIS checkout's current
;; prompt_engine_lib.bb: the composer code itself is not what changed at
;; that commit, only the constitution content is.
(ns prompt-engine-compose-at-root
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "prompt_engine_lib.bb")))

(let [root (first *command-line-args*)]
  (when (or (nil? root) (empty? root))
    (binding [*out* *err*]
      (println "usage: prompt_engine_compose_at_root.bb <materialized-root>"))
    (System/exit 2))
  (println (str "stable-prefix chars: " (count (prompt-engine-lib/stable-prefix-text root)))))
