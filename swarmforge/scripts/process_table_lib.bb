#!/usr/bin/env bb
;; Cross-platform process-table primitives for the orphan reapers.
;; Linux/WSL: prefer /proc (cmdline + pid enumeration).
;; Darwin (and any host without procfs): java.lang.ProcessHandle.allProcesses —
;; /proc does not exist on macOS, so a /proc-only scan silently reaps nothing.

(ns process-table-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(defn procfs-available?
  []
  (boolean (and (fs/exists? "/proc") (fs/directory? "/proc"))))

(defn- cmdline-from-procfs
  [pid]
  (try
    (str/replace (slurp (str (fs/path "/proc" (str pid) "cmdline"))) "\u0000" " ")
    (catch Exception _ "")))

(defn- cmdline-from-handle
  [ph]
  (try
    (let [info (.info ph)
          cl (.orElse (.commandLine info) nil)]
      (if (and cl (not (str/blank? cl)))
        cl
        (let [cmd (.orElse (.command info) nil)
              args (seq (.orElse (.arguments info) (into-array String [])))]
          (if cmd
            (str/join " " (cons cmd args))
            ""))))
    (catch Exception _ "")))

(defn cmdline!
  "Best-effort command line for pid. Empty string when unavailable."
  [pid]
  (if (procfs-available?)
    (cmdline-from-procfs pid)
    (try
      (if-let [ph (.orElse (java.lang.ProcessHandle/of (long pid)) nil)]
        (cmdline-from-handle ph)
        "")
      (catch Exception _ ""))))

(defn list-pids!
  "All numeric pids visible on this host, or nil when the process table
   could not be enumerated. BL-849: nil is never conflated with an empty
   vector - a caller distinguishing 'nothing to reap' from 'I cannot see
   the process table' depends on that distinction surviving here, the
   root of every candidate scan."
  []
  (try
    (if (procfs-available?)
      (->> (fs/list-dir "/proc")
           (keep (fn [p] (try (Long/parseLong (fs/file-name p)) (catch Exception _ nil))))
           vec)
      (->> (iterator-seq (.iterator (java.lang.ProcessHandle/allProcesses)))
           (map #(.pid %))
           vec))
    (catch Exception _ nil)))

(defn list-processes!
  "Return [{:pid Long :cmdline String}] for processes with a non-blank
   cmdline, or nil when the process table could not be enumerated (BL-849 -
   see list-pids!'s docstring; the /proc branch propagates list-pids!'s own
   nil via when-let rather than `keep`-ing over it, which would otherwise
   silently degrade a failed read into an empty-but-successful result)."
  []
  (try
    (if (procfs-available?)
      (when-let [pids (list-pids!)]
        (->> pids
             (keep (fn [pid]
                     (let [cmd (cmdline-from-procfs pid)]
                       (when-not (str/blank? cmd)
                         {:pid pid :cmdline cmd}))))
             vec))
      (->> (iterator-seq (.iterator (java.lang.ProcessHandle/allProcesses)))
           (keep (fn [ph]
                   (let [cmd (cmdline-from-handle ph)]
                     (when-not (str/blank? cmd)
                       {:pid (.pid ph) :cmdline cmd}))))
           vec))
    (catch Exception _ nil)))

(defn age-ms!
  "Process age via ProcessHandle startInstant when available; else 0.
   Prefer this over /proc/<pid> mtime (unstable on WSL; absent on Darwin)."
  [pid]
  (try
    (if-let [ph (.orElse (java.lang.ProcessHandle/of (long pid)) nil)]
      (if-let [start (.orElse (.startInstant (.info ph)) nil)]
        (- (System/currentTimeMillis) (.toEpochMilli start))
        0)
      0)
    (catch Exception _ 0)))

(defn- cwd-from-procfs
  [pid]
  (try
    (let [cwd-link (fs/path "/proc" (str pid) "cwd")]
      (when (fs/exists? cwd-link)
        (str (fs/real-path cwd-link))))
    (catch Exception _ nil)))

(defn- cwd-from-lsof
  "Darwin (and other non-procfs hosts): lsof reports cwd as an `n…` path line."
  [pid]
  (try
    (let [{:keys [out]} (process/sh {:continue true} "lsof" "-a" "-p" (str pid) "-d" "cwd" "-Fn")]
      (->> (str/split-lines (or out ""))
           (keep (fn [line]
                   (when (str/starts-with? line "n")
                     (subs line 1))))
           (remove str/blank?)
           first))
    (catch Exception _ nil)))

(defn cwd!
  "Best-effort absolute cwd for pid."
  [pid]
  (if (procfs-available?)
    (cwd-from-procfs pid)
    (cwd-from-lsof pid)))
