#!/usr/bin/env bb
;; mono_router_rows_cli.bb — print the role the mono-router would rotate
;; the resident to right now, or `none`. Same answer and same output shape
;; as `handoffd.bb <root> --print-preferred-rotate-target`, without booting
;; the daemon (no stale-stub healing, no daemon log line). Used by the
;; drift guard in test_handoffd_priority_rotate_wiring.sh and handy for an
;; operator asking "where would the router send the resident next?".
;;
;; Usage: mono_router_rows_cli.bb <project-root>

(ns mono-router-rows-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "mono_router_rows_lib.bb")))

(let [root (first *command-line-args*)]
  (when (or (nil? root) (not (fs/directory? root)))
    (binding [*out* *err*]
      (println "Usage: mono_router_rows_cli.bb <project-root>"))
    (System/exit 2))
  (println (or (mono-router-rows-lib/preferred-rotate-role (str (fs/canonicalize root))) "none")))
