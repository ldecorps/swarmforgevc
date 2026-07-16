#!/usr/bin/env bb
;; Shared /proc scanning primitives for "is any live process rooted in this
;; directory" checks - a process's cwd AND its open file descriptors both
;; count as "rooted in" a path (a log it writes to, a lockfile, a socket
;; file on disk is exactly as rooted as a process that cd'd there). Loaded
;; by BOTH operator_runtime.bb's sandbox-sweep! (BL-413) and
;; fixture_reaper_sweep_lib.bb's sweep! (BL-458) - ONE real implementation,
;; two callers, never a second reimplementation.

(ns proc-fd-scan-lib
  (:require [babashka.fs :as fs]))

(defn process-cwd-path [pid-dir]
  (try
    (let [cwd-link (fs/path pid-dir "cwd")]
      (when (fs/exists? cwd-link)
        (str (fs/real-path cwd-link))))
    (catch Exception _ nil)))

(defn process-open-paths [pid-dir]
  (try
    (let [fd-dir (fs/path pid-dir "fd")]
      (if (fs/exists? fd-dir)
        (keep (fn [fd] (try (str (fs/real-path fd)) (catch Exception _ nil))) (fs/list-dir fd-dir))
        []))
    (catch Exception _ [])))
