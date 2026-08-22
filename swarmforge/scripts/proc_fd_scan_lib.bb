#!/usr/bin/env bb
;; Shared process-liveness scanning primitives for "is any live process
;; rooted in this directory" checks - a process's cwd AND its open file
;; descriptors both count as "rooted in" a path (a log it writes to, a
;; lockfile, a socket file on disk is exactly as rooted as a process that
;; cd'd there). Loaded by BOTH operator_runtime.bb's sandbox-sweep!
;; (BL-413) and fixture_reaper_sweep_lib.bb's sweep! (BL-458) - ONE real
;; implementation, two callers, never a second reimplementation.
;;
;; BL-877: /proc does not exist on macOS (a declared target OS), so both
;; callers were silently inert there - a stale sandbox is deleted out from
;; under a live process (sandbox-sweep) and an orphan is never killed
;; (fixture-reaper). live-pid-paths! below is the ONE entry point both
;; callers now use: /proc when present (Linux/WSL, unchanged), a single
;; `lsof` invocation otherwise (Darwin) - never a second call per
;; candidate/pid, matching the existing "scan once per sweep pass" cost
;; discipline. Returns nil (never a coerced-empty map) when NEITHER
;; facility is reachable - process_table_lib.bb's own BL-849 contract for
;; exactly this class of "cannot determine" vs "determined, found nothing".

(ns proc-fd-scan-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

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

(defn- proc-root
  "Almost always \"/proc\" - overridable via SWARMFORGE_PROC_DIR so a test
   on a host with no real /proc (this project's own macOS dev/CI host) can
   still exercise the procfs scanning branch end-to-end against a synthetic
   tree of real symlinks, the same portable-override posture as lsof-bin's
   SWARMFORGE_LSOF_BIN below."
  []
  (let [override (System/getenv "SWARMFORGE_PROC_DIR")]
    (if (str/blank? override) "/proc" override)))

(defn procfs-available? []
  (try (and (fs/exists? (proc-root)) (fs/directory? (proc-root))) (catch Exception _ false)))

(defn- live-pid-paths-procfs! []
  (->> (fs/list-dir (proc-root))
       (keep (fn [pid-dir]
               (when-let [pid (try (Long/parseLong (fs/file-name pid-dir)) (catch Exception _ nil))]
                 [pid (set (remove nil? (cons (process-cwd-path pid-dir) (process-open-paths pid-dir))))])))
       (into {})))

(defn- lsof-fd-id-rooting? [fd]
  (boolean (and fd (or (= fd "cwd") (re-matches #"\d+" fd)))))

(defn parse-lsof-pfn-output
  "Pure parser for `lsof -F pfn`'s line-oriented output -> {pid #{path...}}.
   Only a `cwd` or purely-numeric fd id counts - lsof also reports the
   loaded executable/shared-library image under fd ids like `txt`/`mem`,
   which /proc/<pid>/fd does NOT include, so excluding them keeps macOS and
   Linux returning the same verdict for the same rooting (invariant 2). A
   name that is not an absolute path (a socket/pipe description) is
   dropped, same as procfs's own non-path `socket:[...]` fd targets -
   harmless noise, never a false positive."
  [text]
  (loop [lines (str/split-lines (or text "")) pid nil fd nil acc (transient {})]
    (if (empty? lines)
      (persistent! acc)
      (let [line (first lines) more (rest lines)]
        (if (str/blank? line)
          (recur more pid fd acc)
          (let [tag (subs line 0 1) val (subs line 1)]
            (case tag
              "p" (recur more (try (Long/parseLong val) (catch Exception _ nil)) nil acc)
              "f" (recur more pid val acc)
              "n" (if (and pid (lsof-fd-id-rooting? fd) (str/starts-with? val "/"))
                    (recur more pid fd (assoc! acc pid (conj (get acc pid #{}) val)))
                    (recur more pid fd acc))
              (recur more pid fd acc))))))))

(defn- lsof-bin []
  (let [override (System/getenv "SWARMFORGE_LSOF_BIN")]
    (or (when-not (str/blank? override) override)
        (some #(when (fs/exists? %) %) ["/usr/sbin/lsof" "/usr/bin/lsof"])
        "lsof")))

(defn- live-pid-paths-lsof! []
  ;; ONE system-wide invocation, no -p/-a filter, covers every pid's cwd +
  ;; open fds in a single exec - matches the "scan once per sweep pass"
  ;; cost discipline the /proc branch already follows. `:continue true`
  ;; means a nonzero exit (lsof commonly exits 1 when some OTHER user's
  ;; processes are permission-restricted, while still printing everything
  ;; it COULD see) is not treated as failure - only an exec failure
  ;; (binary missing) throws, which the caller below catches as
  ;; "unavailable".
  (let [{:keys [out]} (process/sh {:continue true} (lsof-bin) "-F" "pfn")]
    (parse-lsof-pfn-output out)))

(defn live-pid-paths!
  "{pid -> #{absolute-path...}} for every live process's cwd and open file
   descriptors, portably: /proc when present (Linux/WSL), a single `lsof`
   call otherwise (Darwin). Read ONCE per call - callers must call this
   once per sweep pass, not once per candidate. Returns nil, never a
   coerced-empty map, when NEITHER facility is reachable - a caller
   distinguishing 'nothing rooted here' from 'liveness cannot be
   determined' depends on that distinction surviving here (BL-877
   invariant 1, mirroring process_table_lib.bb's BL-849 list-pids!
   contract)."
  []
  (cond
    (procfs-available?) (try (live-pid-paths-procfs!) (catch Exception _ nil))
    :else (try (live-pid-paths-lsof!) (catch Exception _ nil))))
